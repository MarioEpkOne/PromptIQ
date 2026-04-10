import Anthropic from '@anthropic-ai/sdk';
import type { LogEntry, Rubric, DayAnalysis, PromptScore, Pattern, Suggestion } from './types.js';

/**
 * Builds the system prompt for the Anthropic API call.
 * Includes the full rubric text so the LLM has a stable reference point.
 */
function buildSystemPrompt(rubric: Rubric): string {
  return `You are PromptIQ, a prompt quality analyzer. Your job is to evaluate prompts sent to an AI coding assistant.

You will be given a batch of prompts and a rubric. Evaluate each prompt against the rubric criteria, identify recurring patterns, and suggest improvements.

## Rubric
${rubric.rawText}

## Response Format
Respond with ONLY valid JSON matching this exact structure. No prose, no markdown fences, just the JSON object:
{
  "scores": [
    {
      "prompt": "the prompt text",
      "score": 0.75,
      "weakestCriterion": "Output Format"
    }
  ],
  "patterns": [
    {
      "id": "missing-output-format",
      "label": "Missing output format",
      "frequency": 18,
      "example": "Explain async/await to me"
    }
  ],
  "suggestions": [
    {
      "patternId": "missing-output-format",
      "text": "Add an expected output format to open-ended requests",
      "before": "Explain async/await to me",
      "after": "Explain async/await in 3 bullet points for someone who knows callbacks"
    }
  ],
  "summary": "A prose summary of today's prompting patterns and overall quality."
}

Rules:
- score is a weighted composite 0-1 based on rubric weights
- Return exactly 3 suggestions (the most impactful ones)
- patterns must include frequency (count of affected prompts)
- summary should be 2-4 sentences suitable for archival in long-term memory
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
 * Parses the LLM response as JSON. Retries once with stricter instructions if the first parse fails.
 */
async function parseWithRetry(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
): Promise<{
  scores: PromptScore[];
  patterns: Pattern[];
  suggestions: Suggestion[];
  summary: string;
}> {
  const attemptParse = async (strictMode: boolean) => {
    const retryNote = strictMode
      ? '\n\nIMPORTANT: Your previous response was not valid JSON. Respond with ONLY the JSON object — no explanation, no markdown code fences, no preamble.'
      : '';

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage + retryNote }],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    // Strip markdown code fences if present
    const stripped = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

    return JSON.parse(stripped);
  };

  try {
    return await attemptParse(false);
  } catch {
    // Retry once with stricter instructions
    try {
      return await attemptParse(true);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude returned non-JSON response after retry. Raw error: ${raw}`);
    }
  }
}

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

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt(rubric);
  const userMessage = buildUserMessage(entries, date);

  const parsed = await parseWithRetry(client, systemPrompt, userMessage);

  const scores: PromptScore[] = parsed.scores ?? [];
  const patterns: Pattern[] = parsed.patterns ?? [];
  const suggestions: Suggestion[] = (parsed.suggestions ?? []).slice(0, 3);
  const summary: string = parsed.summary ?? '';

  return {
    date,
    promptCount: entries.length,
    avgScore: computeAvgScore(scores),
    scores,
    patterns,
    suggestions,
    summary,
  };
}
