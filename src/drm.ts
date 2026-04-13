import * as fs from 'fs';
import * as path from 'path';
import { promptiqDir, readEntriesForDate, deleteDailyFile, listDailyDates } from './logger.js';
import { synthesizeWeek } from './analyzer.js';
import type {
  DayAnalysis,
  WeeklyRecord,
  WeeklyRecordDaily,
  WeeklyRecordCompressed,
  MonthlyRecord,
  WeekDayRecord,
} from './types.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function weeklyDir(): string {
  return path.join(promptiqDir(), 'weekly');
}

function monthlyDir(): string {
  return path.join(promptiqDir(), 'monthly');
}

function weeklyPath(week: string): string {
  return path.join(weeklyDir(), `${week}.json`);
}

function monthlyPath(month: string): string {
  return path.join(monthlyDir(), `${month}.json`);
}

// ---------------------------------------------------------------------------
// ISO week number helpers
// ---------------------------------------------------------------------------

/**
 * Returns the ISO week string (e.g. "2026-W15") for a given date string.
 */
export function isoWeekLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00Z'); // noon UTC to avoid TZ edge cases
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + (4 - (date.getUTCDay() || 7)));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const year = thursday.getUTCFullYear();
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Returns the Monday (start) and Sunday (end) of the ISO week containing the given date.
 */
function weekBounds(dateStr: string): { startDate: string; endDate: string } {
  const date = new Date(dateStr + 'T12:00:00Z');
  const dayOfWeek = date.getUTCDay() || 7; // Mon=1 … Sun=7
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (dayOfWeek - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { startDate: fmt(monday), endDate: fmt(sunday) };
}

// ---------------------------------------------------------------------------
// Weekly file I/O
// ---------------------------------------------------------------------------

function readWeekly(week: string): WeeklyRecord | null {
  const filePath = weeklyPath(week);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WeeklyRecord;
  } catch {
    return null;
  }
}

function writeWeekly(record: WeeklyRecord): void {
  fs.mkdirSync(weeklyDir(), { recursive: true });
  fs.writeFileSync(weeklyPath(record.week), JSON.stringify(record, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Monthly file I/O
// ---------------------------------------------------------------------------

function readMonthly(month: string): MonthlyRecord | null {
  const filePath = monthlyPath(month);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MonthlyRecord;
    return normalizeMonthly(raw);
  } catch {
    return null;
  }
}

function normalizeMonthly(record: MonthlyRecord): MonthlyRecord {
  return { ...record, patternFrequency: record.patternFrequency ?? {} };
}

function writeMonthly(record: MonthlyRecord): void {
  fs.mkdirSync(monthlyDir(), { recursive: true });
  fs.writeFileSync(monthlyPath(record.month), JSON.stringify(record, null, 2), 'utf-8');
}

function listWeeklyFiles(): string[] {
  const dir = weeklyDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

// ---------------------------------------------------------------------------
// DRM core logic
// ---------------------------------------------------------------------------

/**
 * Upserts today's DayAnalysis into the current week's weekly file.
 * Creates the weekly file if it doesn't exist.
 * This is called at the END of each `analyze` run, before rollup.
 */
export function upsertDayInWeekly(analysis: DayAnalysis): void {
  const week = isoWeekLabel(analysis.date);
  const bounds = weekBounds(analysis.date);
  const existing = readWeekly(week);

  const dayRecord: WeekDayRecord = {
    promptCount: analysis.promptCount,
    avgScore: analysis.avgScore,
    topPatterns: analysis.patterns.map(p => p.id),
    summary: analysis.summary,
    suggestions: analysis.suggestions,
    mainTip: analysis.mainTip,
  };

  if (!existing || existing.detail === 'daily') {
    const record: WeeklyRecordDaily = existing && existing.detail === 'daily'
      ? { ...(existing as WeeklyRecordDaily) }
      : {
          week,
          startDate: bounds.startDate,
          endDate: bounds.endDate,
          detail: 'daily',
          days: {},
        };
    record.days[analysis.date] = dayRecord;
    writeWeekly(record);
  } else {
    // Weekly was compressed — overwrite with daily detail (re-analyzed day)
    const record: WeeklyRecordDaily = {
      week,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      detail: 'daily',
      days: { [analysis.date]: dayRecord },
    };
    writeWeekly(record);
  }
}

/**
 * Writes an error record into the weekly file for a given date.
 * Does NOT overwrite an existing successful analysis entry.
 * Called from cli.ts catch block when analyzeToday() throws.
 */
export function upsertErrorInWeekly(
  date: string,
  promptCount: number,
  errorType: string,
  errorMessage: string,
): void {
  const week = isoWeekLabel(date);
  const bounds = weekBounds(date);
  const existing = readWeekly(week);

  const errorRecord: WeekDayRecord = {
    promptCount,
    avgScore: 0,
    topPatterns: [],
    summary: '',
    error: true,
    errorType,
    errorMessage,
  };

  if (!existing || existing.detail === 'daily') {
    const record: WeeklyRecordDaily =
      existing && existing.detail === 'daily'
        ? { ...(existing as WeeklyRecordDaily) }
        : {
            week,
            startDate: bounds.startDate,
            endDate: bounds.endDate,
            detail: 'daily',
            days: {},
          };

    // Guard: do not overwrite a successful analysis
    const existing_day = record.days[date];
    if (existing_day && !existing_day.error) {
      return; // successful entry present — do not overwrite
    }

    record.days[date] = errorRecord;
    writeWeekly(record);
  } else {
    // Compressed — only add error record if the date is not already captured.
    // A compressed week implies prior successful analysis, so do nothing.
    return;
  }
}

/**
 * Returns the ISO week label for "the most recent full week" (last complete Monday–Sunday).
 */
function mostRecentFullWeek(): string {
  const today = new Date();
  // Go back to last Sunday
  const lastSunday = new Date(today);
  lastSunday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() || 7)));
  const lastSundayStr = lastSunday.toISOString().split('T')[0];
  return isoWeekLabel(lastSundayStr);
}

/**
 * Full DRM rollup. Called automatically at end of each `analyze` run.
 *
 * Step 1: Daily → Weekly: for each daily file older than 7 days, if not already
 *         summarized in weekly, create/update the weekly entry, then delete the daily file.
 * Step 2: Weekly detail decay: most recent full week keeps 'daily' detail.
 *         All older weeks are compressed to aggregate.
 * Step 3: Weekly → Monthly: weeks older than 4 full weeks merge into monthly, then deleted.
 */
export async function runRollup(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

  // Step 1: Roll old daily files into weekly
  const dailyDates = listDailyDates();
  for (const date of dailyDates) {
    if (date >= today) continue; // never roll today
    const dateObj = new Date(date + 'T12:00:00Z');
    if (dateObj > sevenDaysAgo) continue; // not old enough

    const week = isoWeekLabel(date);
    let weekly = readWeekly(week);

    // Check if this date is already captured in the weekly file
    if (weekly && weekly.detail === 'daily' && date in weekly.days) {
      // Already captured — just delete the daily file
      deleteDailyFile(date);
      continue;
    }

    if (weekly && weekly.detail === 'compressed') {
      // Already compressed — daily file is redundant
      deleteDailyFile(date);
      continue;
    }

    // Read the daily file and create a minimal day record
    const entries = readEntriesForDate(date);
    if (entries.length === 0) {
      deleteDailyFile(date);
      continue;
    }

    const bounds = weekBounds(date);
    const dayRecord: WeekDayRecord = {
      promptCount: entries.length,
      avgScore: 0, // No analysis score available for un-analyzed old files
      topPatterns: [],
      summary: `${entries.length} prompts logged (not analyzed before rollup).`,
    };

    if (!weekly) {
      weekly = {
        week,
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        detail: 'daily',
        days: {},
      } as WeeklyRecordDaily;
    }

    if (weekly.detail === 'daily') {
      (weekly as WeeklyRecordDaily).days[date] = dayRecord;
    }

    // Write weekly FIRST, then delete daily (invariant: never delete before writing)
    writeWeekly(weekly);
    deleteDailyFile(date);
  }

  // Step 2: Compress older weekly files
  const recentFullWeek = mostRecentFullWeek();
  const allWeeks = listWeeklyFiles();

  for (const week of allWeeks) {
    if (week >= recentFullWeek) continue; // keep most recent full week at daily detail

    const record = readWeekly(week);
    if (!record || record.detail === 'compressed') continue;

    // Compress from daily to aggregate
    const dailyRecord = record as WeeklyRecordDaily;
    const days = Object.values(dailyRecord.days);
    const validDays = days.filter(d => !d.error);
    const totalPrompts = validDays.reduce((s, d) => s + d.promptCount, 0);
    const avgScore =
      validDays.length > 0
        ? validDays.reduce((s, d) => s + d.avgScore * d.promptCount, 0) / Math.max(totalPrompts, 1)
        : 0;
    const patternCounts: Record<string, number> = {};
    for (const d of days) {
      for (const p of d.topPatterns) {
        patternCounts[p] = (patternCounts[p] ?? 0) + 1;
      }
    }
    const topPatterns = Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    let summaries: string;
    try {
      summaries = await synthesizeWeek(week, dailyRecord.days);
    } catch {
      console.warn('[PromptIQ] synthesizeWeek() threw unexpectedly — using fallback');
      summaries = days.map(d => d.summary).filter(Boolean).join(' ');
    }

    const compressed: WeeklyRecordCompressed = {
      week,
      startDate: dailyRecord.startDate,
      endDate: dailyRecord.endDate,
      detail: 'compressed',
      promptCount: totalPrompts,
      avgScore: Math.min(1, avgScore),
      topPatterns,
      summary: summaries || `${totalPrompts} prompts across ${days.length} days.`,
    };

    writeWeekly(compressed);
  }

  // Step 3: Roll old weekly files into monthly
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);

  const updatedWeeks = listWeeklyFiles();
  for (const week of updatedWeeks) {
    const record = readWeekly(week);
    if (!record) continue;

    // Parse week start date to check age
    const startDate = new Date(record.startDate + 'T12:00:00Z');
    if (startDate > fourWeeksAgo) continue; // not old enough

    // Determine month from startDate (use end of week's month)
    const endDate = new Date(record.endDate + 'T12:00:00Z');
    const month = endDate.toISOString().slice(0, 7); // YYYY-MM

    let monthly = readMonthly(month);

    const weekPromptCount =
      record.detail === 'compressed'
        ? record.promptCount
        : Object.values((record as WeeklyRecordDaily).days).reduce(
            (s, d) => s + d.promptCount,
            0,
          );

    const weekAvgScore =
      record.detail === 'compressed'
        ? record.avgScore
        : (() => {
            const days = Object.values((record as WeeklyRecordDaily).days);
            const total = days.reduce((s, d) => s + d.promptCount, 0);
            return total > 0
              ? days.reduce((s, d) => s + d.avgScore * d.promptCount, 0) / total
              : 0;
          })();

    const weekPatterns =
      record.detail === 'compressed'
        ? record.topPatterns
        : (() => {
            const counts: Record<string, number> = {};
            for (const d of Object.values((record as WeeklyRecordDaily).days)) {
              for (const p of d.topPatterns) counts[p] = (counts[p] ?? 0) + 1;
            }
            return Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([id]) => id);
          })();

    const weekSummary =
      record.detail === 'compressed'
        ? record.summary
        : Object.values((record as WeeklyRecordDaily).days)
            .map(d => d.summary)
            .filter(Boolean)
            .join(' ');

    if (!monthly) {
      monthly = {
        month,
        weekCount: 0,
        promptCount: 0,
        avgScore: 0,
        persistentPatterns: [],
        patternFrequency: {},
        summary: '',
      };
    }

    // Weighted merge into monthly
    const oldTotal = monthly.promptCount;
    const newTotal = oldTotal + weekPromptCount;
    const newAvg =
      newTotal > 0
        ? (monthly.avgScore * oldTotal + weekAvgScore * weekPromptCount) / newTotal
        : 0;

    // Increment frequency for each pattern seen this week
    const freq = { ...monthly.patternFrequency };
    for (const p of weekPatterns) {
      freq[p] = (freq[p] ?? 0) + 1;
    }

    // Persistent = patterns seen in >= 2 separate weekly merges, top 5 by frequency
    const persistent = Object.entries(freq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    monthly = {
      month,
      weekCount: monthly.weekCount + 1,
      promptCount: newTotal,
      avgScore: Math.min(1, newAvg),
      patternFrequency: freq,
      persistentPatterns: persistent,
      summary: [monthly.summary, weekSummary].filter(Boolean).join(' '),
    };

    // Write monthly FIRST, then delete weekly
    writeMonthly(monthly);
    fs.unlinkSync(weeklyPath(week));
  }
}

/**
 * Builds a historical context string from all available DRM data.
 * Returns empty string if no history exists (first run).
 * Called by analyzeToday() to inject trend context into the system prompt.
 */
export function buildHistoryContext(): string {
  const { weeklyFiles, monthlyFiles } = getDrmSummary();

  if (weeklyFiles.length === 0 && monthlyFiles.length === 0) {
    return '';
  }

  const lines: string[] = ['## Historical Context', ''];

  if (monthlyFiles.length > 0) {
    lines.push('### Monthly summaries');
    for (const m of monthlyFiles.slice().reverse()) {
      lines.push(
        `- ${m.month}: ${m.promptCount} prompts, avg score ${m.avgScore.toFixed(2)} — ${m.summary || '(no summary)'}`,
      );
    }
    lines.push('');
  }

  if (weeklyFiles.length > 0) {
    lines.push('### Weekly summaries (recent)');
    for (const w of weeklyFiles.slice().reverse()) {
      if (w.detail === 'compressed') {
        lines.push(
          `- ${w.week} (${w.startDate} – ${w.endDate}): ${w.promptCount} prompts, avg score ${w.avgScore.toFixed(2)} — ${w.summary || '(no summary)'}`,
        );
      } else {
        const daily = w as WeeklyRecordDaily;
        const days = Object.entries(daily.days)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([date, d]) =>
              `  - ${date}: ${d.promptCount} prompts, avg score ${d.avgScore.toFixed(2)}${d.error ? ' [FAILED]' : ''}`,
          )
          .join('\n');
        lines.push(`- ${w.week} (${w.startDate} – ${w.endDate}):`);
        lines.push(days);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Returns DRM summary data for display in `status` and `patterns` commands.
 */
export function getWeeklyDetail(week: string): WeeklyRecord | null {
  return readWeekly(week);
}

export function getMonthlyDetail(month: string): MonthlyRecord | null {
  return readMonthly(month);
}

/**
 * Returns the WeekDayRecord for a specific date, or null if not found.
 * Looks up the weekly file that contains the date.
 * Returns null if the week has been compressed (daily detail gone).
 */
export function getDayDetail(date: string): WeekDayRecord | null {
  const week = isoWeekLabel(date);
  const record = readWeekly(week);
  if (!record || record.detail !== 'daily') return null;
  return (record as WeeklyRecordDaily).days[date] ?? null;
}

/**
 * Returns the most recent successfully-analyzed date across all weekly files.
 * Skips error days. Falls back to compressed week endDate if no daily detail found.
 */
export function findLastAnalysisDate(weeklyFiles: WeeklyRecord[]): string | null {
  let lastDate: string | null = null;

  for (const w of weeklyFiles) {
    if (w.detail === 'daily') {
      for (const [date, d] of Object.entries((w as WeeklyRecordDaily).days)) {
        if (!d.error && (!lastDate || date > lastDate)) {
          lastDate = date;
        }
      }
    }
  }

  // Compressed week fallback: if no daily detail found, use endDate of compressed weeks
  if (!lastDate) {
    for (const w of weeklyFiles) {
      if (w.detail === 'compressed') {
        if (!lastDate || w.endDate > lastDate) {
          lastDate = w.endDate;
        }
      }
    }
  }

  return lastDate;
}

export function getDrmSummary(): {
  weeklyFiles: WeeklyRecord[];
  monthlyFiles: MonthlyRecord[];
} {
  const weeklyFiles = listWeeklyFiles()
    .map(w => readWeekly(w))
    .filter((w): w is WeeklyRecord => w !== null);

  const monthlyDir2 = monthlyDir();
  const monthlyFiles: MonthlyRecord[] = [];
  if (fs.existsSync(monthlyDir2)) {
    for (const f of fs.readdirSync(monthlyDir2).filter(f => f.endsWith('.json')).sort()) {
      const record = readMonthly(f.replace('.json', ''));
      if (record) monthlyFiles.push(record);
    }
  }

  return { weeklyFiles, monthlyFiles };
}
