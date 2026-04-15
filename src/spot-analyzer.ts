import Anthropic from '@anthropic-ai/sdk';
import { loadRubric } from './rubric.js';
import type { CriterionScore, SpotAnalysis, SpotSuggestion } from './types.js';

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

const ANALYZE_SINGLE_PROMPT_TOOL: Anthropic.Tool = {
  name: 'analyze_single_prompt',
  description: 'Report a detailed quality analysis of a single prompt.',
  input_schema: {
    type: 'object',
    properties: {
      criterionScores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            criterion: { type: 'string' },
            score: { type: 'number' },
            weight: { type: 'number' },
          },
          required: ['criterion', 'score', 'weight'],
        },
      },
      patterns: { type: 'array', items: { type: 'string' } },
      suggestions: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            criterion: { type: 'string' },
            issue: { type: 'string' },
            fix: { type: 'string' },
          },
          required: ['criterion', 'issue', 'fix'],
        },
      },
      improvedPrompt: { type: 'string' },
      improvementReasons: { type: 'array', items: { type: 'string' } },
    },
    required: ['criterionScores', 'patterns', 'suggestions', 'improvedPrompt', 'improvementReasons'],
  },
};

/**
 * Analyzes a single prompt against the user's rubric and returns a SpotAnalysis.
 *
 * Throws if:
 * - ANTHROPIC_API_KEY is not set (caller should validate before calling)
 * - The Anthropic API returns no tool_use block
 *
 * Never throws for missing rubric.md (loadRubric() falls back to built-in default).
 * Never returns NaN for overallScore (guards to 0 on degenerate weights).
 */
export async function analyzePromptSpot(prompt: string): Promise<SpotAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const rubric = loadRubric();

  const systemPrompt = `You are a prompt quality expert. Analyze the following single prompt against the provided rubric criteria.

<rubric criteria="${rubric.criteria.length}">
${escapeXml(rubric.rawText)}
</rubric>

Your analysis must:
1. Score each criterion independently on a 0–1 scale
2. Identify up to 3 patterns from this canonical list: missing-context, vague-scope, no-constraints, missing-language, no-edge-cases, ambiguous-intent, missing-format, too-broad
3. List the 3 highest-impact improvements, each linked to a specific criterion
4. Rewrite the prompt incorporating all improvements. The rewrite must be grammatically correct, written in fluent natural English exactly as a human would write it — no mechanical phrasing, no XML tags, no bullet points, just the improved prompt text
5. For each improvement, give a one-line reason stating what changed and why`;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    tools: [ANALYZE_SINGLE_PROMPT_TOOL],
    tool_choice: { type: 'tool', name: 'analyze_single_prompt' },
    messages: [{ role: 'user', content: `Analyze the following prompt:\n\n<prompt index="1">\n${escapeXml(prompt)}\n</prompt>` }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('spot-analyzer returned no tool_use block');
  }

  const input = (toolUse as Anthropic.ToolUseBlock).input as Omit<SpotAnalysis, 'overallScore'>;

  const criterionScores: CriterionScore[] = input.criterionScores ?? [];
  const patterns: string[] = input.patterns ?? [];
  const suggestions: SpotSuggestion[] = input.suggestions ?? [];
  const improvedPrompt: string = input.improvedPrompt ?? '';
  const improvementReasons: string[] = input.improvementReasons ?? [];

  const weightedSum = criterionScores.reduce((sum, c) => sum + c.score * c.weight, 0);
  const totalWeight = criterionScores.reduce((sum, c) => sum + c.weight, 0);
  const overallScore = totalWeight > 0 ? (isNaN(weightedSum / totalWeight) ? 0 : weightedSum / totalWeight) : 0;

  return {
    overallScore,
    criterionScores,
    patterns,
    suggestions,
    improvedPrompt,
    improvementReasons,
  };
}
