import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock chalk (ESM-only — Jest runs CJS, so chalk must be mocked)
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

// Mock Anthropic to avoid real API calls in integration tests
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tu_int_test',
            name: 'report_analysis',
            input: {
              scores: [
                { prompt: 'Prompt A', score: 0.6, weakestCriterion: 'Clarity' },
                { prompt: 'Prompt B', score: 0.7, weakestCriterion: 'Context' },
                { prompt: 'Prompt C', score: 0.8, weakestCriterion: 'Scope' },
              ],
              patterns: [{ id: 'test-pattern', label: 'Test Pattern', frequency: 2, example: 'Prompt A' }],
              suggestions: [
                { patternId: 'test-pattern', text: 'Be more specific', before: 'Prompt A', after: 'Detailed Prompt A' },
              ],
              summary: 'Integration test summary.',
              mainTip: {
                text: 'Add more context to each prompt.',
                why: 'Context helps the AI understand the problem domain and produce better responses.',
              },
            },
          },
        ],
      }),
    },
  })),
}));

describe('integration: analyze flow', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptiq-int-test-'));
    process.env.PROMPTIQ_HOME = tempDir;
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PROMPTIQ_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('full analyze flow: seed daily file → analyze → weekly entry created', async () => {
    const { ensureDirectories, todayLogPath } = await import('../logger.js');
    const { loadRubric } = await import('../rubric.js');
    const { analyzeToday } = await import('../analyzer.js');
    const { upsertDayInWeekly } = await import('../drm.js');

    ensureDirectories();

    // Seed daily file with 3 task prompts + 2 control prompts
    const today = new Date().toISOString().split('T')[0];
    const filePath = todayLogPath();
    const entries = [
      { timestamp: '2026-04-10T10:00:00Z', prompt: 'Prompt A — implement retry mechanism for the HTTP client' },
      { timestamp: '2026-04-10T10:01:00Z', prompt: 'yes' },
      { timestamp: '2026-04-10T10:02:00Z', prompt: 'Prompt B — refactor the database layer to use repositories' },
      { timestamp: '2026-04-10T10:03:00Z', prompt: 'ok' },
      { timestamp: '2026-04-10T10:04:00Z', prompt: 'Prompt C — add unit tests for the auth module edge cases' },
    ];
    fs.writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const rubric = loadRubric();
    const analysis = await analyzeToday(entries, rubric, today);
    upsertDayInWeekly(analysis);

    // Verify weekly entry was created
    const { isoWeekLabel } = await import('../drm.js');
    const weekLabel = isoWeekLabel(today);
    const weeklyPath = path.join(tempDir, '.promptiq', 'weekly', `${weekLabel}.json`);
    expect(fs.existsSync(weeklyPath)).toBe(true);

    const weeklyContent = JSON.parse(fs.readFileSync(weeklyPath, 'utf-8'));
    expect(weeklyContent.detail).toBe('daily');
    expect(weeklyContent.days[today]).toBeDefined();
    // promptCount must be task-only (3 task, 2 control excluded)
    expect(weeklyContent.days[today].promptCount).toBe(3);
    // Total entries passed in were 5, so if promptCount is 3, controls were excluded
    expect(entries.length).toBe(5);
    // mainTip must be persisted in the weekly record
    expect(weeklyContent.days[today].mainTip).toBeDefined();
    expect(weeklyContent.days[today].mainTip.text).toBe('Add more context to each prompt.');
    expect(weeklyContent.days[today].mainTip.why).toBe('Context helps the AI understand the problem domain and produce better responses.');
  });

  it('8-day simulation: day-8 file rolls into weekly on rollup', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { runRollup } = await import('../drm.js');
    ensureDirectories();

    // Create 8 daily files — the oldest (8 days ago) should roll into weekly
    for (let daysAgo = 8; daysAgo >= 1; daysAgo--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - daysAgo);
      const dateStr = d.toISOString().split('T')[0];
      const dailyPath = path.join(tempDir, '.promptiq', 'daily', `${dateStr}.jsonl`);
      fs.writeFileSync(
        dailyPath,
        JSON.stringify({ timestamp: d.toISOString(), prompt: `Prompt from ${dateStr}` }) + '\n',
      );
    }

    await runRollup();

    // The 8-days-ago file should be gone (rolled into weekly)
    const eightDaysAgo = new Date();
    eightDaysAgo.setUTCDate(eightDaysAgo.getUTCDate() - 8);
    const eightDaysAgoStr = eightDaysAgo.toISOString().split('T')[0];
    const deletedPath = path.join(tempDir, '.promptiq', 'daily', `${eightDaysAgoStr}.jsonl`);
    expect(fs.existsSync(deletedPath)).toBe(false);

    // Verify weekly file exists
    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    const weeklyFiles = fs.readdirSync(weeklyDir);
    expect(weeklyFiles.length).toBeGreaterThan(0);
  });

  it('5-week simulation: week-5 rolls into monthly on rollup', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { runRollup, isoWeekLabel } = await import('../drm.js');
    ensureDirectories();

    // Create 5 weekly files with startDates going back 5–1 weeks
    // The oldest (5 weeks ago = 35 days ago) has startDate > 28 days ago, triggering monthly rollup
    for (let weeksAgo = 5; weeksAgo >= 1; weeksAgo--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - weeksAgo * 7);
      const dateStr = d.toISOString().split('T')[0];
      const weekLabel = isoWeekLabel(dateStr);
      const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
      fs.mkdirSync(weeklyDir, { recursive: true });
      // Compute the Monday of that week for startDate
      const dayOfWeek = d.getUTCDay() || 7;
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - (dayOfWeek - 1));
      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);
      const fmt = (dt: Date) => dt.toISOString().split('T')[0];
      fs.writeFileSync(
        path.join(weeklyDir, `${weekLabel}.json`),
        JSON.stringify({
          week: weekLabel,
          startDate: fmt(monday),
          endDate: fmt(sunday),
          detail: 'compressed',
          promptCount: 20,
          avgScore: 0.65,
          topPatterns: ['test-pattern'],
          summary: `Week ${weekLabel} summary.`,
        }),
      );
    }

    await runRollup();

    // At least one monthly file should have been created (oldest week rolled into monthly)
    const monthlyDir = path.join(tempDir, '.promptiq', 'monthly');
    expect(fs.existsSync(monthlyDir)).toBe(true);
    const monthlyFiles = fs.readdirSync(monthlyDir).filter(f => f.endsWith('.json'));
    expect(monthlyFiles.length).toBeGreaterThan(0);
  });

  it('feedback command: sets actedOnTip in weekly file and prints mainTip confirmation', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly } = await import('../drm.js');
    ensureDirectories();

    // Seed a weekly record with a known day
    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.65,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'A day.',
      mainTip: { text: 'Write clearer goals.', why: 'Clarity saves iterations.' },
    });

    // Simulate the feedback command logic
    const { setActedOnTip } = await import('../drm.js');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));

    const { mainTip } = setActedOnTip('2026-04-10');
    if (mainTip?.text) {
      console.log(`Recorded: acted on "${mainTip.text}" for 2026-04-10.`);
    } else {
      console.log(`Recorded: acted on tip for 2026-04-10.`);
    }
    console.log = origLog;

    expect(logs.join('\n')).toContain('Write clearer goals.');
    expect(logs.join('\n')).toContain('Recorded: acted on');

    // Verify the file was actually updated
    const { getDayDetail } = await import('../drm.js');
    const day = getDayDetail('2026-04-10');
    expect(day?.actedOnTip).toBe(true);
  });

  it('status command: shows Tip follow-through when >= 2 acted pairs exist', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { computeFeedbackCorrelation } = await import('../drm.js');
    const { renderStatus } = await import('../renderer.js');
    ensureDirectories();

    // Build weekly files with 2 acted+followed-up pairs in memory
    const weeklyFiles = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily' as const,
        days: {
          '2026-04-10': { promptCount: 5, avgScore: 0.6, topPatterns: [], summary: 'A.', actedOnTip: true as const },
          '2026-04-11': { promptCount: 5, avgScore: 0.75, topPatterns: [], summary: 'B.' },
          '2026-04-12': { promptCount: 5, avgScore: 0.5, topPatterns: [], summary: 'C.', actedOnTip: true as const },
          '2026-04-13': { promptCount: 5, avgScore: 0.8, topPatterns: [], summary: 'D.' },
        },
      },
    ];

    const feedbackCorrelation = computeFeedbackCorrelation(weeklyFiles);
    expect(feedbackCorrelation).not.toBeNull();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    renderStatus(0, null, weeklyFiles, [], feedbackCorrelation);
    console.log = origLog;

    expect(logs.join('\n')).toContain('Tip follow-through');
  });

  it('status command: no Tip follow-through line when < 2 pairs', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { computeFeedbackCorrelation } = await import('../drm.js');
    const { renderStatus } = await import('../renderer.js');
    ensureDirectories();

    const weeklyFiles = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily' as const,
        days: {
          '2026-04-10': { promptCount: 5, avgScore: 0.6, topPatterns: [], summary: 'A.', actedOnTip: true as const },
          '2026-04-11': { promptCount: 5, avgScore: 0.75, topPatterns: [], summary: 'B.' },
          // Only 1 pair
        },
      },
    ];

    const feedbackCorrelation = computeFeedbackCorrelation(weeklyFiles);
    expect(feedbackCorrelation).toBeNull();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    renderStatus(0, null, weeklyFiles, [], feedbackCorrelation);
    console.log = origLog;

    expect(logs.join('\n')).not.toContain('Tip follow-through');
  });
});
