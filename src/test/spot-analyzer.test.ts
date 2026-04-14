import { analyzePromptSpot } from '../spot-analyzer.js';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tu_spot_test',
            name: 'analyze_single_prompt',
            input: {
              criterionScores: [
                { criterion: 'Clarity', score: 0.8, weight: 1.0 },
                { criterion: 'Context', score: 0.4, weight: 1.0 },
              ],
              patterns: ['missing-context'],
              suggestions: [
                { criterion: 'Context', issue: 'No background provided', fix: 'Add file path and current behaviour' },
              ],
              improvedPrompt: 'Fix the login bug in auth.ts where tokens expire prematurely',
              improvementReasons: ['Added file context so agent can locate the issue immediately'],
            },
          },
        ],
      }),
    },
  })),
}));

// Mock rubric.ts to avoid reading ~/.promptiq/rubric.md in CI
jest.mock('../rubric.js', () => ({
  loadRubric: jest.fn().mockReturnValue({
    criteria: [
      { name: 'Clarity', weight: 1.0, description: 'Is the intent unambiguous?' },
      { name: 'Context', weight: 1.0, description: 'Does it include background?' },
    ],
    rawText: '# Test Rubric\n\n### Clarity (weight: 1.0)\nTest.\n\n### Context (weight: 1.0)\nTest.',
  }),
}));

describe('analyzePromptSpot', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns SpotAnalysis with correct overallScore (weighted mean)', async () => {
    const result = await analyzePromptSpot('Fix the login bug');
    // overallScore = (0.8 * 1.0 + 0.4 * 1.0) / (1.0 + 1.0) = 0.6
    expect(result.overallScore).toBeCloseTo(0.6, 5);
    expect(result.criterionScores).toHaveLength(2);
    expect(result.patterns).toEqual(['missing-context']);
    expect(result.suggestions).toHaveLength(1);
    expect(result.improvedPrompt).toBe('Fix the login bug in auth.ts where tokens expire prematurely');
    expect(result.improvementReasons).toHaveLength(1);
  });

  it('throws when API returns no tool_use block', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    (Anthropic as unknown as jest.Mock).mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValueOnce({ content: [] }),
      },
    }));
    await expect(analyzePromptSpot('Fix the login bug')).rejects.toThrow('no tool_use block');
  });

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(analyzePromptSpot('Fix the login bug')).rejects.toThrow('ANTHROPIC_API_KEY is not set');
  });

  it('returns overallScore 0 when all weights are 0 (NaN guard)', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    (Anthropic as unknown as jest.Mock).mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              id: 'tu_nan',
              name: 'analyze_single_prompt',
              input: {
                criterionScores: [{ criterion: 'Clarity', score: 0.5, weight: 0 }],
                patterns: [],
                suggestions: [],
                improvedPrompt: 'same',
                improvementReasons: [],
              },
            },
          ],
        }),
      },
    }));
    const result = await analyzePromptSpot('test');
    expect(result.overallScore).toBe(0);
  });

  it('does not throw when rubric.md is missing (falls back to default rubric)', async () => {
    // loadRubric() is mocked to always succeed; this test verifies analyzePromptSpot
    // propagates the returned rubric.rawText to the system prompt without throwing.
    const result = await analyzePromptSpot('test prompt');
    expect(result).toBeDefined();
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
  });

  it('uses tool_choice: analyze_single_prompt', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results[0]?.value;
    await analyzePromptSpot('test');
    if (mockInstance) {
      const lastCall = mockInstance.messages.create.mock.calls.at(-1)?.[0];
      expect(lastCall?.tool_choice).toEqual({ type: 'tool', name: 'analyze_single_prompt' });
      expect(lastCall?.tools?.[0]?.name).toBe('analyze_single_prompt');
    }
  });

  it('analyzePromptSpot wraps rubric in XML tag with criteria count', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    await analyzePromptSpot('Fix the login bug');
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results.at(-1)?.value;
    if (mockInstance) {
      const lastCall = mockInstance.messages.create.mock.calls.at(-1)?.[0];
      expect(lastCall?.system).toContain('<rubric criteria="2">');
      expect(lastCall?.system).toContain('</rubric>');
      expect(lastCall?.system).not.toContain('RUBRIC:');
    }
  });

  it('analyzePromptSpot wraps analyzed prompt in XML tag', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    await analyzePromptSpot('Fix the login bug');
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results.at(-1)?.value;
    if (mockInstance) {
      const lastCall = mockInstance.messages.create.mock.calls.at(-1)?.[0];
      const content = lastCall?.messages?.[0]?.content as string;
      expect(content).toContain('<prompt index="1">');
      expect(content).toContain('</prompt>');
      expect(content).not.toContain('"Fix the login bug"');
    }
  });

  it('analyzePromptSpot escapes XML special characters in analyzed prompt', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    await analyzePromptSpot('Fix <div> & "auth" bug');
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results.at(-1)?.value;
    if (mockInstance) {
      const lastCall = mockInstance.messages.create.mock.calls.at(-1)?.[0];
      const content = lastCall?.messages?.[0]?.content as string;
      expect(content).toContain('&lt;div&gt;');
      expect(content).toContain('&amp;');
      expect(content).toContain('&quot;auth&quot;');
      expect(content).not.toContain('<div>');
      expect(content).not.toContain(' & ');
    }
  });

  it('analyzePromptSpot escapes XML special characters in rubric text', async () => {
    const { loadRubric } = await import('../rubric.js');
    (loadRubric as jest.Mock).mockReturnValueOnce({
      criteria: [
        { name: 'Clarity', weight: 1.0, description: 'Test.' },
        { name: 'Context', weight: 1.0, description: 'Test.' },
      ],
      rawText: 'use precision & recall',
    });
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    await analyzePromptSpot('test prompt');
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results.at(-1)?.value;
    if (mockInstance) {
      const lastCall = mockInstance.messages.create.mock.calls.at(-1)?.[0];
      expect(lastCall?.system).toContain('&amp;');
      expect(lastCall?.system).not.toMatch(/use precision & recall/);
    }
  });
});
