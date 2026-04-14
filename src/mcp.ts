import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getDrmSummary,
  findLastAnalysisDate,
  computeFeedbackCorrelation,
} from './drm.js';
import { readTodayEntries, ensureDirectories } from './logger.js';
import type {
  WeeklyRecordDaily,
  WeeklyRecordCompressed,
  WeekDayRecord,
} from './types.js';

// ---------------------------------------------------------------------------
// XML escape helper
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Tool builders
// ---------------------------------------------------------------------------

export function buildStatusXml(): string {
  ensureDirectories();
  const { weeklyFiles, monthlyFiles } = getDrmSummary();
  const lastAnalysisDate = findLastAnalysisDate(weeklyFiles);
  const todayEntries = readTodayEntries();
  const correlation = computeFeedbackCorrelation(weeklyFiles);

  const hasData = weeklyFiles.length > 0 || monthlyFiles.length > 0;

  let xml = '<status>\n';
  xml += `  <hasData>${hasData}</hasData>\n`;
  xml += `  <todayCount>${todayEntries.length}</todayCount>\n`;

  if (lastAnalysisDate) {
    xml += `  <lastAnalysisDate>${lastAnalysisDate}</lastAnalysisDate>\n`;
  } else {
    xml += `  <lastAnalysisDate>none</lastAnalysisDate>\n`;
  }

  xml += `  <weeklyRecords>${weeklyFiles.length}</weeklyRecords>\n`;
  xml += `  <monthlyRecords>${monthlyFiles.length}</monthlyRecords>\n`;

  if (correlation) {
    const sign = correlation.avgDelta >= 0 ? '+' : '';
    const delta = `${sign}${(correlation.avgDelta * 100).toFixed(1)}pts`;
    xml += `  <feedbackCorrelation count="${correlation.count}" avgDelta="${delta}" />\n`;
  }

  if (!hasData) {
    xml += `  <message>No analysis data found. Run 'promptiq analyze' first.</message>\n`;
  }

  xml += '</status>';
  return xml;
}

export function buildPatternsXml(): string {
  ensureDirectories();
  const { weeklyFiles, monthlyFiles } = getDrmSummary();

  if (weeklyFiles.length === 0 && monthlyFiles.length === 0) {
    return "<patterns>\n  <hasData>false</hasData>\n  <message>No analysis data found. Run 'promptiq analyze' first.</message>\n</patterns>";
  }

  let xml = '<patterns>\n  <hasData>true</hasData>\n  <weekly>\n';

  for (const w of [...weeklyFiles].reverse()) {
    if (w.detail === 'daily') {
      const daily = w as WeeklyRecordDaily;
      xml += `    <week id="${w.week}" detail="daily" start="${w.startDate}" end="${w.endDate}">\n`;
      for (const [date, d] of Object.entries(daily.days).sort(([a], [b]) => b.localeCompare(a))) {
        if (d.error) continue;
        xml += `      <day date="${date}" score="${d.avgScore.toFixed(2)}" promptCount="${d.promptCount}">\n`;
        for (const p of d.topPatterns) xml += `        <pattern>${escapeXml(p)}</pattern>\n`;
        if (d.summary) xml += `        <summary>${escapeXml(d.summary)}</summary>\n`;
        xml += `      </day>\n`;
      }
      xml += `    </week>\n`;
    } else {
      const compressed = w as WeeklyRecordCompressed;
      xml += `    <week id="${w.week}" detail="compressed" start="${w.startDate}" end="${w.endDate}" avgScore="${compressed.avgScore.toFixed(2)}" promptCount="${compressed.promptCount}">\n`;
      for (const p of compressed.topPatterns) xml += `      <pattern>${escapeXml(p)}</pattern>\n`;
      xml += `    </week>\n`;
    }
  }

  xml += '  </weekly>\n  <monthly>\n';

  for (const m of [...monthlyFiles].reverse()) {
    xml += `    <month id="${m.month}" avgScore="${m.avgScore.toFixed(2)}" promptCount="${m.promptCount}" weekCount="${m.weekCount}">\n`;
    for (const p of m.persistentPatterns) xml += `      <persistentPattern>${escapeXml(p)}</persistentPattern>\n`;
    if (m.summary) xml += `      <summary>${escapeXml(m.summary)}</summary>\n`;
    xml += `    </month>\n`;
  }

  xml += '  </monthly>\n</patterns>';
  return xml;
}

export function buildMainTipXml(): string {
  ensureDirectories();
  const { weeklyFiles } = getDrmSummary();

  let best: { date: string; record: WeekDayRecord } | null = null;

  for (const w of weeklyFiles) {
    if (w.detail !== 'daily') continue;
    const daily = w as WeeklyRecordDaily;
    for (const [date, d] of Object.entries(daily.days)) {
      if (d.error || !d.mainTip) continue;
      if (!best || date > best.date) {
        best = { date, record: d };
      }
    }
  }

  if (!best) {
    return "<main_tip>\n  <hasData>false</hasData>\n  <message>No tip available yet. Run 'promptiq analyze' first.</message>\n</main_tip>";
  }

  const tip = best.record.mainTip!;
  const acted = best.record.actedOnTip === true ? 'true' : 'false';

  return [
    '<main_tip>',
    '  <hasData>true</hasData>',
    `  <date>${best.date}</date>`,
    `  <tip>${escapeXml(tip.text)}</tip>`,
    `  <why>${escapeXml(tip.why)}</why>`,
    `  <actedOnTip>${acted}</actedOnTip>`,
    `  <score>${best.record.avgScore.toFixed(2)}</score>`,
    '</main_tip>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// MCP server entry point
// ---------------------------------------------------------------------------

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'promptiq', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_status',
        description:
          "Returns PromptIQ status: today's unanalyzed prompt count, last analysis date, DRM record counts, and feedback correlation (if available).",
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'get_patterns',
        description:
          'Returns all pattern history from PromptIQ DRM: weekly and monthly records with scores, top patterns, and summaries.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'get_main_tip',
        description:
          'Returns the most recent actionable coaching tip from PromptIQ, with the reason why it matters and whether the user has acted on it.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;

    if (name === 'get_status') {
      return { content: [{ type: 'text', text: buildStatusXml() }] };
    }
    if (name === 'get_patterns') {
      return { content: [{ type: 'text', text: buildPatternsXml() }] };
    }
    if (name === 'get_main_tip') {
      return { content: [{ type: 'text', text: buildMainTipXml() }] };
    }

    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
