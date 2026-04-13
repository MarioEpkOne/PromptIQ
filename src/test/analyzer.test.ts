import { analyzeToday } from '../analyzer.js';
import type { LogEntry, Rubric } from '../types.js';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'tu_test',
              name: 'report_analysis',
              input: {
                scores: [
                  { prompt: 'Fix the bug', score: 0.4, weakestCriterion: 'Context' },
                  { prompt: 'Explain async', score: 0.5, weakestCriterion: 'Output Format' },
                  { prompt: 'Refactor this', score: 0.7, weakestCriterion: 'Scope' },
                ],
                patterns: [
                  {
                    id: 'missing-output-format',
                    label: 'Missing output format',
                    frequency: 2,
                    example: 'Explain async',
                  },
                ],
                suggestions: [
                  {
                    patternId: 'missing-output-format',
                    text: 'Add an expected output format',
                    before: 'Explain async',
                    after: 'Explain async in 3 bullet points',
                  },
                ],
                summary: 'Test summary.',
                mainTip: {
                  text: 'Always specify expected output format.',
                  why: 'Clear output format reduces ambiguity and improves response quality.',
                },
              },
            },
          ],
        }),
      },
    })),
  };
});

const MOCK_RUBRIC: Rubric = {
  criteria: [
    { name: 'Clarity', weight: 1.0, description: 'Is the intent unambiguous?' },
    { name: 'Context', weight: 1.0, description: 'Does it include background?' },
  ],
  rawText: '# Test Rubric\n\n### Clarity (weight: 1.0)\nTest.\n\n### Context (weight: 1.0)\nTest.',
};

const MOCK_ENTRIES: LogEntry[] = [
  { timestamp: '2026-04-10T10:00:00Z', prompt: 'Fix the bug' },
  { timestamp: '2026-04-10T10:01:00Z', prompt: 'Explain async' },
  { timestamp: '2026-04-10T10:02:00Z', prompt: 'Refactor this' },
];

describe('analyzer', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('throws if ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(analyzeToday(MOCK_ENTRIES, MOCK_RUBRIC, '2026-04-10')).rejects.toThrow(
      'ANTHROPIC_API_KEY is not set',
    );
  });

  it('returns structured DayAnalysis from mocked API response', async () => {
    const result = await analyzeToday(MOCK_ENTRIES, MOCK_RUBRIC, '2026-04-10');
    expect(result.date).toBe('2026-04-10');
    expect(result.promptCount).toBe(3);
    expect(result.scores).toHaveLength(3);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].id).toBe('missing-output-format');
    expect(result.suggestions).toHaveLength(1);
    expect(result.summary).toBe('Test summary.');
    expect(result.mainTip).toBeDefined();
    expect(result.mainTip.text).toBe('Always specify expected output format.');
    expect(result.mainTip.why).toBe('Clear output format reduces ambiguity and improves response quality.');
  });

  it('avgScore is computed as weighted average of scores', async () => {
    const result = await analyzeToday(MOCK_ENTRIES, MOCK_RUBRIC, '2026-04-10');
    const expected = (0.4 + 0.5 + 0.7) / 3;
    expect(result.avgScore).toBeCloseTo(expected, 5);
  });

  it('includes rubric rawText in system prompt (verifiable via mock calls)', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results[0]?.value;
    if (mockInstance) {
      const calls = mockInstance.messages.create.mock.calls;
      const lastCall = calls[calls.length - 1]?.[0];
      expect(lastCall?.system).toContain('Test Rubric');
    }
  });

  it('calls messages.create with tool_choice: report_analysis', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results[0]?.value;
    await analyzeToday(MOCK_ENTRIES, MOCK_RUBRIC, '2026-04-10');
    if (mockInstance) {
      const calls = mockInstance.messages.create.mock.calls;
      const lastCall = calls[calls.length - 1]?.[0];
      expect(lastCall?.tools).toBeDefined();
      expect(lastCall?.tools?.[0]?.name).toBe('report_analysis');
      expect(lastCall?.tool_choice).toEqual({ type: 'tool', name: 'report_analysis' });
    }
  });

  it('tool schema includes mainTip in required array with text/why string properties', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results[0]?.value;
    await analyzeToday(MOCK_ENTRIES, MOCK_RUBRIC, '2026-04-10');
    if (mockInstance) {
      const calls = mockInstance.messages.create.mock.calls;
      const lastCall = calls[calls.length - 1]?.[0];
      const schema = lastCall?.tools?.[0]?.input_schema;
      expect(schema?.required).toContain('mainTip');
      expect(schema?.properties?.mainTip?.type).toBe('object');
      expect(schema?.properties?.mainTip?.properties?.text?.type).toBe('string');
      expect(schema?.properties?.mainTip?.properties?.why?.type).toBe('string');
    }
  });

  it('throws when mainTip is missing from tool_use response', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    (Anthropic as unknown as jest.Mock).mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValueOnce({
          content: [
            {
              type: 'tool_use',
              id: 'tu_no_tip',
              name: 'report_analysis',
              input: {
                scores: [{ prompt: '1', score: 0.5, weakestCriterion: 'Clarity' }],
                patterns: [],
                suggestions: [],
                summary: 'Test.',
                // mainTip deliberately absent
              },
            },
          ],
        }),
      },
    }));
    await expect(analyzeToday(MOCK_ENTRIES, MOCK_RUBRIC, '2026-04-10')).rejects.toThrow(
      'missing mainTip',
    );
  });

  it('throws if no tool_use block returned', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    // Override the factory to return an instance with an empty content response
    (Anthropic as unknown as jest.Mock).mockImplementationOnce(() => ({
      messages: {
        create: jest.fn().mockResolvedValueOnce({ content: [] }),
      },
    }));
    await expect(analyzeToday(MOCK_ENTRIES, MOCK_RUBRIC, '2026-04-10')).rejects.toThrow(
      'Analyzer returned no tool_use block',
    );
  });

  it('does not inject historical context into system prompt', async () => {
    // buildHistoryContext is no longer called from analyzeToday() — history injection was removed.
    // Verify the system prompt does NOT contain '## Historical Context'.
    const Anthropic = (await import('@anthropic-ai/sdk')).default as jest.MockedClass<
      typeof import('@anthropic-ai/sdk').default
    >;
    const mockInstance = (Anthropic as unknown as jest.Mock).mock.results[0]?.value;
    await analyzeToday(MOCK_ENTRIES, MOCK_RUBRIC, '2026-04-10');
    if (mockInstance) {
      const calls = mockInstance.messages.create.mock.calls;
      const lastCall = calls[calls.length - 1]?.[0];
      // No history files in test env — history section should be absent
      expect(lastCall?.system).not.toContain('## Historical Context');
    }
  });
});
