import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('drm', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptiq-drm-test-'));
    process.env.PROMPTIQ_HOME = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.PROMPTIQ_HOME;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('isoWeekLabel returns correct week for known date', async () => {
    const { isoWeekLabel } = await import('../drm.js');
    // 2026-04-10 is a Friday in ISO week 15
    expect(isoWeekLabel('2026-04-10')).toBe('2026-W15');
    // 2026-04-07 is a Tuesday — also W15
    expect(isoWeekLabel('2026-04-07')).toBe('2026-W15');
  });

  it('upsertDayInWeekly creates weekly file if missing', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly } = await import('../drm.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 10,
      avgScore: 0.7,
      scores: [],
      patterns: [{ id: 'test', label: 'Test', frequency: 5, example: 'x' }],
      suggestions: [],
      summary: 'Test day.',
    });

    const weeklyPath = path.join(tempDir, '.promptiq', 'weekly', '2026-W15.json');
    expect(fs.existsSync(weeklyPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(weeklyPath, 'utf-8'));
    expect(content.week).toBe('2026-W15');
    expect(content.detail).toBe('daily');
    expect(content.days['2026-04-10'].promptCount).toBe(10);
  });

  it('runRollup rolls daily file older than 7 days into weekly', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { runRollup } = await import('../drm.js');
    ensureDirectories();

    // Write a daily file 10 days ago
    const oldDate = new Date();
    oldDate.setUTCDate(oldDate.getUTCDate() - 10);
    const oldDateStr = oldDate.toISOString().split('T')[0];
    const dailyPath = path.join(tempDir, '.promptiq', 'daily', `${oldDateStr}.jsonl`);
    fs.writeFileSync(
      dailyPath,
      JSON.stringify({ timestamp: '2026-04-01T10:00:00Z', prompt: 'Old prompt' }) + '\n',
    );

    await runRollup();

    // Daily file should be deleted
    expect(fs.existsSync(dailyPath)).toBe(false);
  });

  it('runRollup does NOT roll today\'s daily file', async () => {
    const { ensureDirectories, todayLogPath } = await import('../logger.js');
    const { runRollup } = await import('../drm.js');
    ensureDirectories();

    const todayPath = todayLogPath();
    fs.writeFileSync(
      todayPath,
      JSON.stringify({ timestamp: new Date().toISOString(), prompt: 'Today prompt' }) + '\n',
    );

    await runRollup();

    expect(fs.existsSync(todayPath)).toBe(true);
  });

  it('runRollup compresses weekly entries older than most recent full week', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { runRollup } = await import('../drm.js');
    ensureDirectories();

    // Write a weekly file from 2 weeks ago (detail: daily)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14);
    const weekAgoStr = twoWeeksAgo.toISOString().split('T')[0];

    // Determine week label
    const { isoWeekLabel } = await import('../drm.js');
    const weekLabel = isoWeekLabel(weekAgoStr);

    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });
    fs.writeFileSync(
      path.join(weeklyDir, `${weekLabel}.json`),
      JSON.stringify({
        week: weekLabel,
        startDate: weekAgoStr,
        endDate: weekAgoStr,
        detail: 'daily',
        days: {
          [weekAgoStr]: { promptCount: 5, avgScore: 0.6, topPatterns: ['test'], summary: 'Old.' },
        },
      }),
    );

    await runRollup();

    const content = JSON.parse(fs.readFileSync(path.join(weeklyDir, `${weekLabel}.json`), 'utf-8'));
    expect(content.detail).toBe('compressed');
    expect(content.promptCount).toBe(5);
    expect(content.avgScore).toBeCloseTo(0.6, 5);
  });

  it('buildHistoryContext returns empty string when no files exist', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { buildHistoryContext } = await import('../drm.js');
    ensureDirectories();
    const result = buildHistoryContext();
    expect(result).toBe('');
  });

  it('buildHistoryContext includes weekly entry when weekly file exists', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { buildHistoryContext } = await import('../drm.js');
    ensureDirectories();

    // Write a compressed weekly file
    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });
    fs.writeFileSync(
      path.join(weeklyDir, '2026-W14.json'),
      JSON.stringify({
        week: '2026-W14',
        startDate: '2026-03-30',
        endDate: '2026-04-05',
        detail: 'compressed',
        promptCount: 42,
        avgScore: 0.71,
        topPatterns: ['missing-context'],
        summary: 'A solid week.',
      }),
    );

    // Also write a monthly file to exercise the monthly data path
    const monthlyDir = path.join(tempDir, '.promptiq', 'monthly');
    fs.mkdirSync(monthlyDir, { recursive: true });
    fs.writeFileSync(
      path.join(monthlyDir, '2026-03.json'),
      JSON.stringify({
        month: '2026-03',
        weekCount: 4,
        promptCount: 150,
        avgScore: 0.68,
        persistentPatterns: ['missing-context', 'vague-goal'],
        summary: 'A productive month with recurring context gaps.',
      }),
    );

    const result = buildHistoryContext();
    expect(result).toContain('## Historical Context');
    expect(result).toContain('2026-W14');
    expect(result).toContain('42 prompts');
    expect(result).toContain('0.71');
    // Monthly section assertions
    expect(result).toContain('### Monthly summaries');
    expect(result).toContain('2026-03');
    expect(result).toContain('150 prompts');
    expect(result).toContain('0.68');
  });

  it('upsertErrorInWeekly writes error record to weekly file', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertErrorInWeekly } = await import('../drm.js');
    ensureDirectories();

    upsertErrorInWeekly('2026-04-10', 5, 'Error', 'API call failed');

    const weeklyPath = path.join(tempDir, '.promptiq', 'weekly', '2026-W15.json');
    expect(fs.existsSync(weeklyPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(weeklyPath, 'utf-8'));
    expect(content.days['2026-04-10'].error).toBe(true);
    expect(content.days['2026-04-10'].errorType).toBe('Error');
    expect(content.days['2026-04-10'].avgScore).toBe(0);
    expect(content.days['2026-04-10'].promptCount).toBe(5);
  });

  it('upsertErrorInWeekly does NOT overwrite a successful analysis entry', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly, upsertErrorInWeekly } = await import('../drm.js');
    ensureDirectories();

    // First: write a successful entry
    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 10,
      avgScore: 0.8,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Great day.',
    });

    // Then: attempt to write an error record for the same day
    upsertErrorInWeekly('2026-04-10', 10, 'Error', 'Something went wrong');

    const weeklyPath = path.join(tempDir, '.promptiq', 'weekly', '2026-W15.json');
    const content = JSON.parse(fs.readFileSync(weeklyPath, 'utf-8'));
    // The successful entry must remain intact
    expect(content.days['2026-04-10'].error).toBeUndefined();
    expect(content.days['2026-04-10'].avgScore).toBeCloseTo(0.8, 5);
    expect(content.days['2026-04-10'].summary).toBe('Great day.');
  });
});
