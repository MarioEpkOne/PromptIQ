import Anthropic from '@anthropic-ai/sdk';
import type { LogEntry, Rubric, DayAnalysis, PromptScore, Pattern, Suggestion, MainTip, WeekDayRecord } from './types.js';
import { classifyEntries, loadClassifierConfig } from './classifier.js';

/**
 * Escapes XML special characters in a string so it is safe to embed in an XML element.
 * & must be replaced first to avoid double-escaping other sequences.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the system prompt for the Anthropic API call.
 * Includes the full rubric text so the LLM has a stable reference point.
 * Optionally includes historical context from DRM.
 */
function buildSystemPrompt(rubric: Rubric): string {
  return `You are PromptIQ, a prompt quality analyzer. Your job is to evaluate prompts sent to an AI coding assistant.

You will be given a batch of prompts and a rubric. Each prompt is wrapped in a <prompt index="N"> tag — use the index attribute value as the reference when populating the scores array. Evaluate each prompt against the rubric criteria, identify recurring patterns, and suggest improvements.

<rubric criteria="${rubric.criteria.length}">
${escapeXml(rubric.rawText)}
</rubric>
Rules:
- score is a weighted composite 0-1 based on rubric weights
- In the scores array, use the prompt's 1-based index (as a string) for the prompt field — do NOT repeat the full prompt text
- Return exactly 3 suggestions (the most impactful ones)
- patterns must include frequency (count of affected prompts)
- summary should be 2-4 sentences suitable for archival in long-term memory
- mainTip must be the single highest-leverage improvement; why must explain the impact on prompt quality
`;
}

/**
 * Builds the user message containing all prompts for today.
 */
function buildUserMessage(entries: LogEntry[], date: string): string {
  const promptList = entries
    .map((e, i) => `${i + 1}. ${e.prompt}`)
    .join('\n');

  return `Date: ${date}
Total prompts: ${entries.length}

Prompts to analyze:
${promptList}`;
}

/**
 * Anthropic tool definition for structured analysis output.
 * Forces the model to return a validated JSON structure via tool_use.
 */
const REPORT_ANALYSIS_TOOL: Anthropic.Tool = {
  name: 'report_analysis',
  description: "Report the structured analysis of today's prompts",
  input_schema: {
    type: 'object',
    properties: {
      scores: {
        type: 'array',
        description: 'One entry per prompt. Use the prompt index (1-based) as the prompt field to save tokens.',
        items: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Prompt index as string, e.g. "1", "2"' },
            score: { type: 'number' },
            weakestCriterion: { type: 'string' },
          },
          required: ['prompt', 'score', 'weakestCriterion'],
        },
      },
      patterns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            frequency: { type: 'number' },
            example: { type: 'string' },
          },
          required: ['id', 'label', 'frequency', 'example'],
        },
      },
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            patternId: { type: 'string' },
            text: { type: 'string' },
            before: { type: 'string', description: 'A realistic example of a weak prompt exhibiting this pattern. Must be grammatically correct, natural English — written exactly as a human would write it.' },
            after: { type: 'string', description: 'An improved rewrite of the before prompt that fixes the pattern. Must be grammatically correct, fluent, and clearly better — no mechanical or template-style phrasing.' },
          },
          required: ['patternId', 'text'],
        },
      },
      summary: { type: 'string' },
      mainTip: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The single most impactful improvement the user can make (1-2 sentences)' },
          why:  { type: 'string', description: 'Why this improvement matters for prompt quality (1-2 sentences)' },
        },
        required: ['text', 'why'],
      },
    },
    required: ['scores', 'patterns', 'suggestions', 'summary', 'mainTip'],
  },
};

/**
 * Computes the weighted average score for the day from per-prompt scores.
 */
function computeAvgScore(scores: PromptScore[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, s) => acc + s.score, 0);
  return Math.min(1, sum / scores.length);
}

/**
 * Main analysis function. Reads all prompts from today, calls Anthropic API,
 * returns structured DayAnalysis.
 *
 * Throws if ANTHROPIC_API_KEY is not set.
 * Throws if API call fails (does not delete daily file — preserved for retry).
 */
export async function analyzeToday(
  entries: LogEntry[],
  rubric: Rubric,
  date: string,
): Promise<DayAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it in your shell profile.');
  }

  // Classify and filter: exclude control prompts (short approvals, confirmations)
  const classifierConfig = loadClassifierConfig();
  const { taskEntries } = classifyEntries(entries, classifierConfig);

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt(rubric);
  const userMessage = buildUserMessage(taskEntries, date);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools: [REPORT_ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: 'report_analysis' },
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Analyzer returned no tool_use block');
  }

  const parsed = (toolUse as Anthropic.ToolUseBlock).input as {
    scores: PromptScore[];
    patterns: Pattern[];
    suggestions: Suggestion[];
    summary: string;
    mainTip: { text: string; why: string };
  };

  // Runtime safety check for required fields
  if (!parsed.scores || !parsed.patterns || !parsed.suggestions || parsed.summary === undefined) {
    throw new Error('Analyzer tool_use block is missing required fields');
  }
  if (!parsed.mainTip || !parsed.mainTip.text || !parsed.mainTip.why) {
    throw new Error('Analyzer tool_use block is missing mainTip or its required sub-fields');
  }

  const scores: PromptScore[] = parsed.scores ?? [];
  const patterns: Pattern[] = parsed.patterns ?? [];
  const suggestions: Suggestion[] = (parsed.suggestions ?? []).slice(0, 3);
  const summary: string = parsed.summary ?? '';
  const mainTip: MainTip = parsed.mainTip;

  return {
    date,
    promptCount: taskEntries.length,
    avgScore: computeAvgScore(scores),
    scores,
    patterns,
    suggestions,
    summary,
    mainTip,
  };
}

/**
 * Synthesizes a weekly narrative from 7 daily summaries using the LLM.
 * Returns a plain-text summary string (not tool_use — simpler format suffices).
 *
 * On any failure (API error, missing key, empty days), returns a fallback string
 * (joined daily summaries) and NEVER throws.
 */
export async function synthesizeWeek(
  week: string,
  days: Record<string, WeekDayRecord>,
): Promise<string> {
  const dayEntries = Object.entries(days).sort(([a], [b]) => a.localeCompare(b));

  // Fallback: join existing summaries (same as current mechanical behavior)
  const fallback = dayEntries
    .map(([, d]) => d.summary)
    .filter(Boolean)
    .join(' ');

  if (dayEntries.length === 0) {
    return fallback;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallback;
  }

  try {
    const client = new Anthropic({ apiKey });

    const systemPrompt = `You are PromptIQ. Synthesize the following daily prompt-quality summaries for ${week} into one coherent 2-4 sentence weekly narrative. Focus on trends, persistent weaknesses, and any notable improvement. Return only the narrative text — no headers, no bullets.`;

    const userLines = dayEntries
      .map(([date, d]) =>
        `${date}: ${d.promptCount} prompts, avg score ${d.avgScore.toFixed(2)}${d.summary ? ' — ' + d.summary : ''}`,
      )
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userLines }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (textBlock && textBlock.type === 'text' && textBlock.text.trim()) {
      return textBlock.text.trim();
    }

    return fallback;
  } catch {
    console.warn('[PromptIQ] synthesizeWeek() failed — using concatenated summaries as fallback');
    return fallback;
  }
}
