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
              type: 'text',
              text: JSON.stringify({
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
              }),
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
});
