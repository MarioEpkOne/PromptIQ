// Mock chalk before importing renderer (chalk v5 is ESM-only; Jest runs CJS)
jest.mock('chalk', () => {
  const identity = (s: string) => s;
  const tagged = Object.assign(identity, {
    bold: Object.assign(identity, { cyan: identity }),
    cyan: Object.assign(identity, { bold: identity }),
    dim: identity,
    yellow: identity,
    green: identity,
    red: identity,
    gray: identity,
    italic: identity,
  });
  return { __esModule: true, default: tagged };
});

import { renderStatus, renderAnalysis } from '../renderer.js';
import type { WeeklyRecord, WeeklyRecordDaily, DayAnalysis } from '../types.js';

describe('renderer', () => {
  let consoleOutput: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    consoleOutput = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('renderStatus shows failed day count when error days present', () => {
    const weeklyFiles: WeeklyRecord[] = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily',
        days: {
          '2026-04-10': {
            promptCount: 5,
            avgScore: 0,
            topPatterns: [],
            summary: '',
            error: true,
            errorType: 'Error',
            errorMessage: 'API failed',
          },
          '2026-04-11': {
            promptCount: 8,
            avgScore: 0.75,
            topPatterns: [],
            summary: 'Good day.',
          },
        },
      } as WeeklyRecordDaily,
    ];

    renderStatus(3, '2026-04-11', weeklyFiles, []);

    const output = consoleOutput.join('\n');
    expect(output).toContain('1 day');
    expect(output).toContain('failed to analyze');
    expect(output).toContain('2026-04-10');
  });

  it('renderAnalysis does not include trend label text in pattern output', () => {
    const analysis: DayAnalysis = {
      date: '2026-04-11',
      promptCount: 5,
      avgScore: 0.8,
      scores: [],
      patterns: [{ id: 'vague-goal', label: 'Vague Goal', frequency: 3, example: 'do x' }],
      suggestions: [],
      summary: 'A good day.',
    };

    renderAnalysis(analysis, 0.7, null, []);

    const output = consoleOutput.join('\n');
    expect(output).not.toContain('trend');
    expect(output).toContain('Vague Goal');
    expect(output).toContain('3 of 5 prompts');
  });

  it('renderStatus does not show warning when no error days', () => {
    const weeklyFiles: WeeklyRecord[] = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily',
        days: {
          '2026-04-11': {
            promptCount: 8,
            avgScore: 0.75,
            topPatterns: [],
            summary: 'Good day.',
          },
        },
      } as WeeklyRecordDaily,
    ];

    renderStatus(3, '2026-04-11', weeklyFiles, []);

    const output = consoleOutput.join('\n');
    expect(output).not.toContain('failed to analyze');
  });
});
