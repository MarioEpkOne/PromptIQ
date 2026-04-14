/**
 * Integration test for analyzePromptSpot — exercises the real response-parsing
 * path (find(b => b.type === 'tool_use'), overallScore computation) without
 * hitting the live Anthropic API. The SDK is patched at the module boundary to
 * return a recorded tool-use fixture.
 *
 * Testing Strategy §4 coverage: verifies the full parse path from SDK response
 * to SpotAnalysis shape, including weighted-mean overallScore.
 */

// Patch the Anthropic SDK before importing the module under test.
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        id: 'msg_fixture',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          {
            type: 'tool_use',
            id: 'tu_integration_test',
            name: 'analyze_single_prompt',
            input: {
              criterionScores: [
                { criterion: 'Clarity',  score: 0.9, weight: 1.0 },
                { criterion: 'Context',  score: 0.5, weight: 2.0 },
              ],
              patterns: ['missing-context', 'vague-scope'],
              suggestions: [
                {
                  criterion: 'Context',
                  issue: 'No background provided',
                  fix: 'Add file path and current behaviour',
                },
              ],
              improvedPrompt: 'Fix the login bug in auth.ts where tokens expire prematurely.',
              improvementReasons: ['Added file context so agent can locate the issue immediately'],
            },
          },
        ],
      }),
    },
  })),
}));

// Suppress rubric file-system reads in CI.
jest.mock('../rubric.js', () => ({
  loadRubric: jest.fn().mockReturnValue({
    criteria: [
      { name: 'Clarity', weight: 1.0, description: 'Is the intent unambiguous?' },
      { name: 'Context', weight: 2.0, description: 'Does it include background?' },
    ],
    rawText: '# Test Rubric\n\n### Clarity (weight: 1.0)\nTest.\n\n### Context (weight: 2.0)\nTest.',
  }),
}));

import { analyzePromptSpot } from '../spot-analyzer.js';

describe('analyzePromptSpot — integration (real parsing path, mocked SDK)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-integration';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('parses tool_use block and returns correct SpotAnalysis shape', async () => {
    const result = await analyzePromptSpot('Fix the login bug');

    // Response shape
    expect(typeof result.overallScore).toBe('number');
    expect(Array.isArray(result.criterionScores)).toBe(true);
    expect(Array.isArray(result.patterns)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(typeof result.improvedPrompt).toBe('string');
    expect(Array.isArray(result.improvementReasons)).toBe(true);
  });

  it('computes weighted-mean overallScore correctly from fixture payload', async () => {
    const result = await analyzePromptSpot('Fix the login bug');
    // overallScore = (0.9 * 1.0 + 0.5 * 2.0) / (1.0 + 2.0) = 1.9 / 3.0 ≈ 0.6333
    expect(result.overallScore).toBeCloseTo(1.9 / 3.0, 5);
  });

  it('extracts patterns and suggestions from fixture payload', async () => {
    const result = await analyzePromptSpot('Fix the login bug');
    expect(result.patterns).toEqual(['missing-context', 'vague-scope']);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].criterion).toBe('Context');
    expect(result.improvedPrompt).toContain('auth.ts');
  });

  it('throws when SDK returns no tool_use block', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    (Anthropic as unknown as jest.Mock).mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValueOnce({ content: [{ type: 'text', text: 'oops' }] }),
      },
    }));
    await expect(analyzePromptSpot('some prompt')).rejects.toThrow('no tool_use block');
  });
});
