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
});
