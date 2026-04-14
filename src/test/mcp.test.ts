import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('mcp builders', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptiq-mcp-test-'));
    process.env.PROMPTIQ_HOME = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.PROMPTIQ_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // buildStatusXml
  // -------------------------------------------------------------------------

  // Test 1: get_status — no data
  it('buildStatusXml returns hasData false with todayCount when no data', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { buildStatusXml } = await import('../mcp.js');
    ensureDirectories();

    const xml = buildStatusXml();
    expect(xml).toContain('<hasData>false</hasData>');
    expect(xml).toContain('<todayCount>');
    expect(xml).toContain('<lastAnalysisDate>none</lastAnalysisDate>');
    expect(xml).toContain('<weeklyRecords>0</weeklyRecords>');
    expect(xml).toContain('<monthlyRecords>0</monthlyRecords>');
    expect(xml).toContain("<message>No analysis data found. Run 'promptiq analyze' first.</message>");
    expect(xml).not.toContain('<feedbackCorrelation');
  });

  // Test 2: get_status — with data
  it('buildStatusXml returns hasData true with correct counts when data present', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly } = await import('../drm.js');
    const { buildStatusXml } = await import('../mcp.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.7,
      scores: [],
      patterns: [{ id: 'vague-scope', label: 'Vague Scope', frequency: 3, example: 'x' }],
      suggestions: [],
      summary: 'Test.',
      mainTip: { text: 'Tip text.', why: 'Why text.' },
    });

    const xml = buildStatusXml();
    expect(xml).toContain('<hasData>true</hasData>');
    expect(xml).toContain('<weeklyRecords>1</weeklyRecords>');
    expect(xml).toContain('<monthlyRecords>0</monthlyRecords>');
    expect(xml).toContain('<lastAnalysisDate>2026-04-10</lastAnalysisDate>');
    expect(xml).not.toContain('<message>');
    expect(xml).not.toContain('<feedbackCorrelation');
  });

  // Test 3: get_status — with feedback correlation
  it('buildStatusXml includes feedbackCorrelation when correlation data exists', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly, setActedOnTip } = await import('../drm.js');
    const { buildStatusXml } = await import('../mcp.js');
    ensureDirectories();

    // Write two days: one with actedOnTip, one following day for delta computation
    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.60,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Day one.',
      mainTip: { text: 'Tip.', why: 'Why.' },
    });
    await upsertDayInWeekly({
      date: '2026-04-11',
      promptCount: 5,
      avgScore: 0.70,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Day two.',
      mainTip: { text: 'Tip2.', why: 'Why2.' },
    });
    setActedOnTip('2026-04-10');
    // Need a second pair for correlation (requires count >= 2)
    await upsertDayInWeekly({
      date: '2026-04-08',
      promptCount: 5,
      avgScore: 0.55,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Day zero.',
      mainTip: { text: 'Tip0.', why: 'Why0.' },
    });
    await upsertDayInWeekly({
      date: '2026-04-09',
      promptCount: 5,
      avgScore: 0.65,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Day 0.5.',
      mainTip: { text: 'Tip0.5.', why: 'Why0.5.' },
    });
    setActedOnTip('2026-04-08');

    const xml = buildStatusXml();
    expect(xml).toContain('<feedbackCorrelation');
    expect(xml).toContain('count="2"');
    expect(xml).toMatch(/avgDelta="[+-]\d+\.\dpts"/);
  });

  // Test 4: get_status — correlation null (< 2 pairs)
  it('buildStatusXml omits feedbackCorrelation element when correlation is null', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly, setActedOnTip } = await import('../drm.js');
    const { buildStatusXml } = await import('../mcp.js');
    ensureDirectories();

    // Only one acted pair — not enough for correlation
    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.60,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Day one.',
      mainTip: { text: 'Tip.', why: 'Why.' },
    });
    await upsertDayInWeekly({
      date: '2026-04-11',
      promptCount: 5,
      avgScore: 0.70,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Day two.',
      mainTip: { text: 'Tip2.', why: 'Why2.' },
    });
    setActedOnTip('2026-04-10');

    const xml = buildStatusXml();
    expect(xml).not.toContain('<feedbackCorrelation');
  });

  // -------------------------------------------------------------------------
  // buildPatternsXml
  // -------------------------------------------------------------------------

  // Test 5: get_patterns — with data (daily + compressed)
  it('buildPatternsXml returns daily and compressed week elements', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly } = await import('../drm.js');
    const { buildPatternsXml } = await import('../mcp.js');
    ensureDirectories();

    // Write a daily-detail week
    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 8,
      avgScore: 0.72,
      scores: [],
      patterns: [{ id: 'vague-scope', label: 'Vague', frequency: 4, example: 'x' }],
      suggestions: [],
      summary: 'A summary.',
      mainTip: { text: 'T', why: 'W' },
    });

    // Write a compressed week directly as JSON
    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    const compressed = {
      week: '2026-W14',
      startDate: '2026-03-31',
      endDate: '2026-04-06',
      detail: 'compressed',
      promptCount: 45,
      avgScore: 0.68,
      topPatterns: ['vague-scope'],
      summary: 'Old week.',
    };
    fs.writeFileSync(path.join(weeklyDir, '2026-W14.json'), JSON.stringify(compressed));

    const xml = buildPatternsXml();
    expect(xml).toContain('<hasData>true</hasData>');
    expect(xml).toContain('detail="daily"');
    expect(xml).toContain('detail="compressed"');
    expect(xml).toContain('<pattern>vague-scope</pattern>');
    expect(xml).toContain('<day date="2026-04-10"');
  });

  // Test 6: get_patterns — error days skipped
  it('buildPatternsXml skips error days', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly, upsertErrorInWeekly } = await import('../drm.js');
    const { buildPatternsXml } = await import('../mcp.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.70,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Good day.',
      mainTip: { text: 'T', why: 'W' },
    });
    upsertErrorInWeekly('2026-04-09', 3, 'ApiError', 'timeout');

    const xml = buildPatternsXml();
    expect(xml).toContain('date="2026-04-10"');
    expect(xml).not.toContain('date="2026-04-09"');
  });

  // Test 7: get_patterns — no data
  it('buildPatternsXml returns hasData false when no records', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { buildPatternsXml } = await import('../mcp.js');
    ensureDirectories();

    const xml = buildPatternsXml();
    expect(xml).toContain('<hasData>false</hasData>');
    expect(xml).toContain('<message>');
  });

  // -------------------------------------------------------------------------
  // buildMainTipXml
  // -------------------------------------------------------------------------

  // Test 8: get_main_tip — returns most recent day with mainTip
  it('buildMainTipXml returns the most recent day with a mainTip', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly } = await import('../drm.js');
    const { buildMainTipXml } = await import('../mcp.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-09',
      promptCount: 5,
      avgScore: 0.65,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Older day.',
      mainTip: { text: 'Older tip.', why: 'Older why.' },
    });
    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.72,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Newer day.',
      mainTip: { text: 'Newer tip.', why: 'Newer why.' },
    });

    const xml = buildMainTipXml();
    expect(xml).toContain('<hasData>true</hasData>');
    expect(xml).toContain('<date>2026-04-10</date>');
    expect(xml).toContain('<tip>Newer tip.</tip>');
    expect(xml).toContain('<why>Newer why.</why>');
    expect(xml).toContain('<actedOnTip>false</actedOnTip>');
    expect(xml).toContain('<score>0.72</score>');
  });

  // Test 9: get_main_tip — actedOnTip true
  it('buildMainTipXml returns actedOnTip true after setActedOnTip', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly, setActedOnTip } = await import('../drm.js');
    const { buildMainTipXml } = await import('../mcp.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.72,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Day.',
      mainTip: { text: 'Act on this.', why: 'It matters.' },
    });
    setActedOnTip('2026-04-10');

    const xml = buildMainTipXml();
    expect(xml).toContain('<actedOnTip>true</actedOnTip>');
  });

  // Test 10: get_main_tip — no mainTip in any record
  it('buildMainTipXml returns hasData false when no mainTip in any record', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { buildMainTipXml } = await import('../mcp.js');
    ensureDirectories();

    const xml = buildMainTipXml();
    expect(xml).toContain('<hasData>false</hasData>');
    expect(xml).toContain('<message>');
  });

  // Test 11: get_main_tip — compressed weeks only → no data
  it('buildMainTipXml returns hasData false when only compressed weeks exist', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { buildMainTipXml } = await import('../mcp.js');
    ensureDirectories();

    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });
    const compressed = {
      week: '2026-W14',
      startDate: '2026-03-31',
      endDate: '2026-04-06',
      detail: 'compressed',
      promptCount: 45,
      avgScore: 0.68,
      topPatterns: ['vague-scope'],
      summary: 'Old.',
    };
    fs.writeFileSync(path.join(weeklyDir, '2026-W14.json'), JSON.stringify(compressed));

    const xml = buildMainTipXml();
    expect(xml).toContain('<hasData>false</hasData>');
  });

  // -------------------------------------------------------------------------
  // escapeXml
  // -------------------------------------------------------------------------

  // Test 12: escapeXml escapes all special characters
  it('escapeXml helper escapes XML special characters', async () => {
    // escapeXml is not exported — test it indirectly via a tip that contains special chars
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly } = await import('../drm.js');
    const { buildMainTipXml } = await import('../mcp.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.72,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Day.',
      mainTip: {
        text: 'Use <b> tags & "quotes" for \'emphasis\'.',
        why: 'Because > matters.',
      },
    });

    const xml = buildMainTipXml();
    expect(xml).toContain('&lt;b&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&apos;');
    expect(xml).toContain('&gt;');
    // Must NOT contain raw unescaped characters
    expect(xml).not.toContain('<b>');
  });
});

// -------------------------------------------------------------------------
// Integration: promptiq mcp --setup
// -------------------------------------------------------------------------

describe('mcp --setup integration', () => {
  // Test 13
  it('promptiq mcp --setup prints valid JSON config to stdout', (done) => {
    const { execFile } = require('child_process') as typeof import('child_process');
    const cliPath = require('path').resolve(__dirname, '../../dist/cli.js');

    execFile('node', [cliPath, 'mcp', '--setup'], { timeout: 10000 }, (err, stdout, stderr) => {
      expect(err).toBeNull();
      // stdout must contain the key JSON fields
      expect(stdout).toContain('"command"');
      expect(stdout).toContain('"args"');
      expect(stdout).toContain('"mcp"');
      expect(stdout).toContain('"mcpServers"');
      expect(stdout).toContain('"promptiq"');
      // process must exit 0 (no err)
      done();
    });
  }, 15000);
});

// -------------------------------------------------------------------------
// Integration: MCP JSON-RPC dispatch over stdio
// -------------------------------------------------------------------------

describe('mcp JSON-RPC dispatch', () => {
  const cliPath = require('path').resolve(__dirname, '../../dist/cli.js');

  function sendJsonRpc(
    toolName: string,
    onData: (data: string) => void,
    onExit: () => void,
  ): import('child_process').ChildProcess {
    const { spawn } = require('child_process') as typeof import('child_process');
    const proc = spawn('node', [cliPath, 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: {} },
    }) + '\n';

    let stdout = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      onData(stdout);
    });

    proc.on('exit', onExit);

    proc.stdin.write(request);

    return proc;
  }

  // Test 14: known tool (get_status) returns a valid JSON-RPC result with XML content
  it('tools/call for get_status returns a valid JSON-RPC result containing XML', (done) => {
    let finished = false;

    const proc = sendJsonRpc(
      'get_status',
      (stdout) => {
        // Wait until we have a complete newline-terminated JSON line
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (finished) return;
          finished = true;
          proc.kill();

          expect(parsed).toHaveProperty('result');
          const result = parsed['result'] as Record<string, unknown>;
          expect(result).toHaveProperty('content');
          const content = result['content'] as Array<{ type: string; text: string }>;
          expect(Array.isArray(content)).toBe(true);
          expect(content[0]).toHaveProperty('type', 'text');
          expect(content[0].text).toContain('<status>');
          done();
        }
      },
      () => {
        if (!finished) {
          finished = true;
          done(new Error('MCP server exited before responding'));
        }
      },
    );
  }, 15000);

  // Test 15: unknown tool returns isError: true in the JSON-RPC response
  it('tools/call for unknown tool returns isError: true', (done) => {
    let finished = false;

    const proc = sendJsonRpc(
      'get_unknown',
      (stdout) => {
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (finished) return;
          finished = true;
          proc.kill();

          expect(parsed).toHaveProperty('result');
          const result = parsed['result'] as Record<string, unknown>;
          expect(result).toHaveProperty('isError', true);
          done();
        }
      },
      () => {
        if (!finished) {
          finished = true;
          done(new Error('MCP server exited before responding'));
        }
      },
    );
  }, 15000);
});
