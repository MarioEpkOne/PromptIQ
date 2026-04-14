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
      mainTip: { text: 'Test tip.', why: 'Test why.' },
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
      mainTip: { text: 'Test tip.', why: 'Test why.' },
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

  it('upsertDayInWeekly stores suggestions in WeekDayRecord', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly } = await import('../drm.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 8,
      avgScore: 0.75,
      scores: [],
      patterns: [{ id: 'vague-goal', label: 'Vague Goal', frequency: 3, example: 'do something' }],
      suggestions: [
        { patternId: 'vague-goal', text: 'Be more specific', before: 'Do something', after: 'Fix the login bug on line 42' },
      ],
      summary: 'Good day with one recurring pattern.',
      mainTip: { text: 'Test tip.', why: 'Test why.' },
    });

    const weeklyPath = path.join(tempDir, '.promptiq', 'weekly', '2026-W15.json');
    const content = JSON.parse(fs.readFileSync(weeklyPath, 'utf-8'));
    const dayRecord = content.days['2026-04-10'];
    expect(dayRecord.suggestions).toBeDefined();
    expect(dayRecord.suggestions).toHaveLength(1);
    expect(dayRecord.suggestions[0].patternId).toBe('vague-goal');
    expect(dayRecord.suggestions[0].before).toBe('Do something');
    expect(dayRecord.suggestions[0].after).toBe('Fix the login bug on line 42');
  });

  it('getDayDetail returns WeekDayRecord for known date', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly, getDayDetail } = await import('../drm.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.6,
      scores: [],
      patterns: [],
      suggestions: [{ patternId: 'p1', text: 'Use context' }],
      summary: 'A day.',
      mainTip: { text: 'Test tip.', why: 'Test why.' },
    });

    const record = getDayDetail('2026-04-10');
    expect(record).not.toBeNull();
    expect(record!.promptCount).toBe(5);
    expect(record!.avgScore).toBeCloseTo(0.6, 5);
    expect(record!.suggestions).toHaveLength(1);
    expect(record!.suggestions![0].patternId).toBe('p1');
  });

  it('getDayDetail returns null for unknown date', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { getDayDetail } = await import('../drm.js');
    ensureDirectories();

    const record = getDayDetail('2026-01-01');
    expect(record).toBeNull();
  });

  it('runRollup compression excludes error days from avgScore', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { runRollup } = await import('../drm.js');
    ensureDirectories();

    // Write a weekly file from 2 weeks ago (detail: daily) with one good day and one error day
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14);
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];
    const dayBefore = new Date(twoWeeksAgo);
    dayBefore.setUTCDate(twoWeeksAgo.getUTCDate() - 1);
    const dayBeforeStr = dayBefore.toISOString().split('T')[0];

    const { isoWeekLabel } = await import('../drm.js');
    const weekLabel = isoWeekLabel(twoWeeksAgoStr);

    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });
    fs.writeFileSync(
      path.join(weeklyDir, `${weekLabel}.json`),
      JSON.stringify({
        week: weekLabel,
        startDate: dayBeforeStr,
        endDate: twoWeeksAgoStr,
        detail: 'daily',
        days: {
          [dayBeforeStr]: {
            promptCount: 10,
            avgScore: 0.8,
            topPatterns: [],
            summary: 'Good day.',
          },
          [twoWeeksAgoStr]: {
            promptCount: 5,
            avgScore: 0,
            topPatterns: [],
            summary: '',
            error: true,
            errorType: 'Error',
            errorMessage: 'API failed',
          },
        },
      }),
    );

    await runRollup();

    const content = JSON.parse(fs.readFileSync(path.join(weeklyDir, `${weekLabel}.json`), 'utf-8'));
    expect(content.detail).toBe('compressed');
    // Only the good day (10 prompts at 0.8) should count — error day excluded
    expect(content.promptCount).toBe(10);
    expect(content.avgScore).toBeCloseTo(0.8, 5);
  });

  it('findLastAnalysisDate skips error days and returns last successful date', async () => {
    const { findLastAnalysisDate } = await import('../drm.js');
    const weeklyFiles = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily' as const,
        days: {
          '2026-04-10': { promptCount: 5, avgScore: 0, topPatterns: [], summary: '', error: true },
          '2026-04-11': { promptCount: 8, avgScore: 0.75, topPatterns: [], summary: 'Good.' },
        },
      },
    ];
    expect(findLastAnalysisDate(weeklyFiles)).toBe('2026-04-11');
  });

  it('findLastAnalysisDate falls back to compressed week endDate when no daily detail', async () => {
    const { findLastAnalysisDate } = await import('../drm.js');
    const weeklyFiles = [
      {
        week: '2026-W14',
        startDate: '2026-03-30',
        endDate: '2026-04-05',
        detail: 'compressed' as const,
        promptCount: 42,
        avgScore: 0.71,
        topPatterns: [],
        summary: 'A week.',
      },
    ];
    expect(findLastAnalysisDate(weeklyFiles)).toBe('2026-04-05');
  });

  it('findLastAnalysisDate returns null when no weekly files', async () => {
    const { findLastAnalysisDate } = await import('../drm.js');
    expect(findLastAnalysisDate([])).toBeNull();
  });

  it('W5: pattern seen in only 1 week does not appear in persistentPatterns after monthly merge', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { runRollup } = await import('../drm.js');
    ensureDirectories();

    // Write a weekly file 5 weeks old (older than 28 days) with one pattern
    const fiveWeeksAgo = new Date();
    fiveWeeksAgo.setUTCDate(fiveWeeksAgo.getUTCDate() - 35);
    const fiveWeeksAgoStr = fiveWeeksAgo.toISOString().split('T')[0];

    const { isoWeekLabel } = await import('../drm.js');
    const weekLabel = isoWeekLabel(fiveWeeksAgoStr);

    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });
    fs.writeFileSync(
      path.join(weeklyDir, `${weekLabel}.json`),
      JSON.stringify({
        week: weekLabel,
        startDate: fiveWeeksAgoStr,
        endDate: fiveWeeksAgoStr,
        detail: 'compressed',
        promptCount: 10,
        avgScore: 0.7,
        topPatterns: ['vague-goal'],
        summary: 'Old week.',
      }),
    );

    await runRollup();

    // Check monthly file was created
    const monthlyDir = path.join(tempDir, '.promptiq', 'monthly');
    const monthlyFiles = fs.existsSync(monthlyDir)
      ? fs.readdirSync(monthlyDir).filter(f => f.endsWith('.json'))
      : [];
    expect(monthlyFiles.length).toBeGreaterThan(0);

    const monthly = JSON.parse(fs.readFileSync(path.join(monthlyDir, monthlyFiles[0]), 'utf-8'));
    // Pattern seen only once — must NOT be in persistentPatterns
    expect(monthly.persistentPatterns).not.toContain('vague-goal');
    // But patternFrequency should track it
    expect(monthly.patternFrequency['vague-goal']).toBe(1);
  });

  it('W5: pattern seen in 2 weeks appears in persistentPatterns after two monthly merges', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { runRollup } = await import('../drm.js');
    ensureDirectories();

    // Write two weekly records from the same month, both 5+ weeks old
    const baseDate = new Date();
    baseDate.setUTCDate(baseDate.getUTCDate() - 35);
    const week1Str = baseDate.toISOString().split('T')[0];
    const week2Date = new Date(baseDate);
    week2Date.setUTCDate(baseDate.getUTCDate() - 7);
    const week2Str = week2Date.toISOString().split('T')[0];

    const { isoWeekLabel } = await import('../drm.js');
    const weekLabel1 = isoWeekLabel(week1Str);
    const weekLabel2 = isoWeekLabel(week2Str);

    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });

    for (const [label, dateStr] of [[weekLabel1, week1Str], [weekLabel2, week2Str]] as [string, string][]) {
      fs.writeFileSync(
        path.join(weeklyDir, `${label}.json`),
        JSON.stringify({
          week: label,
          startDate: dateStr,
          endDate: dateStr,
          detail: 'compressed',
          promptCount: 10,
          avgScore: 0.7,
          topPatterns: ['vague-goal'],
          summary: 'Old week.',
        }),
      );
    }

    await runRollup();

    const monthlyDir = path.join(tempDir, '.promptiq', 'monthly');
    const monthlyFiles = fs.existsSync(monthlyDir)
      ? fs.readdirSync(monthlyDir).filter(f => f.endsWith('.json'))
      : [];
    expect(monthlyFiles.length).toBeGreaterThan(0);

    // Find the relevant monthly file (use the one with highest count or just take first)
    let monthly: { persistentPatterns: string[]; patternFrequency: Record<string, number> } | null = null;
    for (const f of monthlyFiles) {
      const m = JSON.parse(fs.readFileSync(path.join(monthlyDir, f), 'utf-8'));
      if (m.patternFrequency?.['vague-goal'] >= 2) {
        monthly = m;
        break;
      }
    }

    expect(monthly).not.toBeNull();
    expect(monthly!.persistentPatterns).toContain('vague-goal');
    expect(monthly!.patternFrequency['vague-goal']).toBeGreaterThanOrEqual(2);
  });

  it('W2: Monday correctly finds Sunday\'s score from previous ISO week', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { isoWeekLabel, upsertDayInWeekly, getDrmSummary } = await import('../drm.js');
    ensureDirectories();

    // Sunday 2026-04-12 is in ISO W15; Monday 2026-04-13 is in ISO W16
    const sunday = '2026-04-12';
    const monday = '2026-04-13';

    // Confirm they are in different ISO weeks (the core W2 invariant)
    expect(isoWeekLabel(sunday)).toBe('2026-W15');
    expect(isoWeekLabel(monday)).toBe('2026-W16');

    // Write Sunday's successful analysis into its weekly file (W15)
    await upsertDayInWeekly({
      date: sunday,
      promptCount: 7,
      avgScore: 0.82,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'A good Sunday.',
      mainTip: { text: 'Test tip.', why: 'Test why.' },
    });

    // Simulate the W2 fallback logic from cli.ts:
    // today = monday, yesterday = sunday
    // currentWeekLabel = isoWeekLabel(monday) = W16 (no entry for sunday here)
    // fallback: lastWeekLabel = isoWeekLabel(sunday) = W15 → should find 0.82
    const yesterday = sunday;
    const todayWeekLabel = isoWeekLabel(monday);
    const lastWeekLabel = isoWeekLabel(yesterday);

    const { weeklyFiles } = getDrmSummary();

    // Primary lookup (current week W16) — should not find sunday
    const currentWeekly = weeklyFiles.find(w => w.week === todayWeekLabel) ?? null;
    let previousDayScore: number | null = null;
    if (currentWeekly && currentWeekly.detail === 'daily') {
      const days = (currentWeekly as import('../types.js').WeeklyRecordDaily).days;
      if (yesterday in days && !days[yesterday].error) {
        previousDayScore = days[yesterday].avgScore;
      }
    }

    // Primary lookup must find nothing (sunday is not in W16)
    expect(previousDayScore).toBeNull();

    // Fallback lookup (last week W15) — should find sunday's score
    if (previousDayScore === null) {
      const lastWeekly = weeklyFiles.find(w => w.week === lastWeekLabel) ?? null;
      if (lastWeekly && lastWeekly.detail === 'daily') {
        const lastDays = (lastWeekly as import('../types.js').WeeklyRecordDaily).days;
        if (yesterday in lastDays && !lastDays[yesterday].error) {
          previousDayScore = lastDays[yesterday].avgScore;
        }
      }
    }

    // Fallback must have found Sunday's score from W15
    expect(previousDayScore).toBeCloseTo(0.82, 5);
  });

  it('getDayDetail returns null for a compressed week', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { getDayDetail } = await import('../drm.js');
    ensureDirectories();

    // Write a compressed weekly file for the week containing 2026-04-10
    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });
    fs.writeFileSync(
      path.join(weeklyDir, '2026-W15.json'),
      JSON.stringify({
        week: '2026-W15',
        startDate: '2026-04-06',
        endDate: '2026-04-12',
        detail: 'compressed',
        promptCount: 20,
        avgScore: 0.7,
        topPatterns: ['vague-goal'],
        summary: 'Compressed week.',
      }),
    );

    const record = getDayDetail('2026-04-10');
    expect(record).toBeNull();
  });

  it('setActedOnTip sets actedOnTip true and returns mainTip', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly, setActedOnTip, getDayDetail } = await import('../drm.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.7,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Test.',
      mainTip: { text: 'Be specific.', why: 'Clarity matters.' },
    });

    const result = setActedOnTip('2026-04-10');
    expect(result.mainTip).toEqual({ text: 'Be specific.', why: 'Clarity matters.' });

    const day = getDayDetail('2026-04-10');
    expect(day?.actedOnTip).toBe(true);
  });

  it('setActedOnTip is idempotent: second call returns same mainTip without extra write', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { upsertDayInWeekly, setActedOnTip } = await import('../drm.js');
    ensureDirectories();

    await upsertDayInWeekly({
      date: '2026-04-10',
      promptCount: 5,
      avgScore: 0.7,
      scores: [],
      patterns: [],
      suggestions: [],
      summary: 'Test.',
      mainTip: { text: 'Be specific.', why: 'Clarity matters.' },
    });

    const r1 = setActedOnTip('2026-04-10');
    const r2 = setActedOnTip('2026-04-10');
    expect(r1.mainTip).toEqual(r2.mainTip);
    // Verify still true after both calls
    const { getDayDetail } = await import('../drm.js');
    const day = getDayDetail('2026-04-10');
    expect(day?.actedOnTip).toBe(true);
  });

  it('setActedOnTip throws "No analysis found" when no weekly file exists', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { setActedOnTip } = await import('../drm.js');
    ensureDirectories();

    expect(() => setActedOnTip('2026-04-10')).toThrow('No analysis found for 2026-04-10');
  });

  it('setActedOnTip throws "compressed" error for compressed weekly', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { setActedOnTip } = await import('../drm.js');
    ensureDirectories();

    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });
    fs.writeFileSync(
      path.join(weeklyDir, '2026-W15.json'),
      JSON.stringify({
        week: '2026-W15',
        startDate: '2026-04-06',
        endDate: '2026-04-12',
        detail: 'compressed',
        promptCount: 20,
        avgScore: 0.7,
        topPatterns: [],
        summary: 'Old.',
      }),
    );

    expect(() => setActedOnTip('2026-04-10')).toThrow('compressed');
  });

  it('setActedOnTip throws "No analysis found" when date not in days map', async () => {
    const { ensureDirectories } = await import('../logger.js');
    const { setActedOnTip } = await import('../drm.js');
    ensureDirectories();

    const weeklyDir = path.join(tempDir, '.promptiq', 'weekly');
    fs.mkdirSync(weeklyDir, { recursive: true });
    fs.writeFileSync(
      path.join(weeklyDir, '2026-W15.json'),
      JSON.stringify({
        week: '2026-W15',
        startDate: '2026-04-06',
        endDate: '2026-04-12',
        detail: 'daily',
        days: {
          '2026-04-08': { promptCount: 5, avgScore: 0.7, topPatterns: [], summary: 'A day.' },
        },
      }),
    );

    // 2026-04-10 is in W15 but not in the days map
    expect(() => setActedOnTip('2026-04-10')).toThrow('No analysis found for 2026-04-10');
  });

  it('computeFeedbackCorrelation returns null when no actedOnTip entries', async () => {
    const { computeFeedbackCorrelation } = await import('../drm.js');
    const weeklyFiles = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily' as const,
        days: {
          '2026-04-10': { promptCount: 5, avgScore: 0.7, topPatterns: [], summary: 'A.' },
          '2026-04-11': { promptCount: 5, avgScore: 0.75, topPatterns: [], summary: 'B.' },
        },
      },
    ];
    expect(computeFeedbackCorrelation(weeklyFiles)).toBeNull();
  });

  it('computeFeedbackCorrelation returns null when only 1 acted+followed-up pair', async () => {
    const { computeFeedbackCorrelation } = await import('../drm.js');
    const weeklyFiles = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily' as const,
        days: {
          '2026-04-10': { promptCount: 5, avgScore: 0.6, topPatterns: [], summary: 'A.', actedOnTip: true },
          '2026-04-11': { promptCount: 5, avgScore: 0.75, topPatterns: [], summary: 'B.' },
          // Only 1 pair — need 2
        },
      },
    ];
    expect(computeFeedbackCorrelation(weeklyFiles)).toBeNull();
  });

  it('computeFeedbackCorrelation returns count and avgDelta for 2 pairs', async () => {
    const { computeFeedbackCorrelation } = await import('../drm.js');
    // Day 10 acted: score 0.6, next day 11: 0.75 → delta +0.15
    // Day 12 acted: score 0.5, next day 13: 0.8  → delta +0.30
    // avgDelta = (0.15 + 0.30) / 2 = 0.225
    const weeklyFiles = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily' as const,
        days: {
          '2026-04-10': { promptCount: 5, avgScore: 0.6, topPatterns: [], summary: 'A.', actedOnTip: true },
          '2026-04-11': { promptCount: 5, avgScore: 0.75, topPatterns: [], summary: 'B.' },
          '2026-04-12': { promptCount: 5, avgScore: 0.5, topPatterns: [], summary: 'C.', actedOnTip: true },
          '2026-04-13': { promptCount: 5, avgScore: 0.8, topPatterns: [], summary: 'D.' },
        },
      },
    ];
    const result = computeFeedbackCorrelation(weeklyFiles);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    expect(result!.avgDelta).toBeCloseTo(0.225, 5);
  });

  it('computeFeedbackCorrelation resolves cross-week lookup correctly', async () => {
    const { computeFeedbackCorrelation } = await import('../drm.js');
    // 2026-04-12 (Sunday, W15) acted; next analyzed day 2026-04-13 (Monday, W16)
    const weeklyFiles: import('../types.js').WeeklyRecord[] = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily' as const,
        days: {
          '2026-04-11': { promptCount: 5, avgScore: 0.6, topPatterns: [], summary: 'A.', actedOnTip: true },
          '2026-04-12': { promptCount: 5, avgScore: 0.5, topPatterns: [], summary: 'B.', actedOnTip: true },
        },
      },
      {
        week: '2026-W16',
        startDate: '2026-04-14',
        endDate: '2026-04-20',
        detail: 'daily' as const,
        days: {
          '2026-04-13': { promptCount: 5, avgScore: 0.8, topPatterns: [], summary: 'C.' },
          '2026-04-14': { promptCount: 5, avgScore: 0.7, topPatterns: [], summary: 'D.' },
        },
      },
    ];
    const result = computeFeedbackCorrelation(weeklyFiles);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    // 2026-04-11 acted (0.6) → next: 2026-04-12 (0.5) → delta -0.1
    // 2026-04-12 acted (0.5) → next: 2026-04-13 (0.8) → delta +0.3
    // avg = (-0.1 + 0.3) / 2 = 0.1
    expect(result!.avgDelta).toBeCloseTo(0.1, 5);
  });

  it('computeFeedbackCorrelation skips acted day with no next-day within 7 days', async () => {
    const { computeFeedbackCorrelation } = await import('../drm.js');
    // Day 10 acted, no subsequent analyzed day within 7 days → data point skipped
    const weeklyFiles = [
      {
        week: '2026-W15',
        startDate: '2026-04-07',
        endDate: '2026-04-13',
        detail: 'daily' as const,
        days: {
          '2026-04-10': { promptCount: 5, avgScore: 0.6, topPatterns: [], summary: 'A.', actedOnTip: true },
          // No next-day within 7 days of 2026-04-10 in any file
        },
      },
    ];
    expect(computeFeedbackCorrelation(weeklyFiles)).toBeNull();
  });
});
