import chalk from 'chalk';
import type {
  DayAnalysis,
  WeeklyRecord,
  WeeklyRecordDaily,
  MonthlyRecord,
} from './types.js';

const DIVIDER = '─'.repeat(62);

function scoreBadge(score: number): string {
  const pct = (score * 100).toFixed(0);
  if (score >= 0.75) return chalk.green(`${pct}`);
  if (score >= 0.5) return chalk.yellow(`${pct}`);
  return chalk.red(`${pct}`);
}

function diffBadge(diff: number): string {
  if (diff === 0) return chalk.gray('  ± 0.00');
  if (diff > 0) return chalk.green(` ▲ +${diff.toFixed(2)}`);
  return chalk.red(` ▼ ${diff.toFixed(2)}`);
}

/**
 * Renders the full `analyze` output block.
 */
export function renderAnalysis(
  analysis: DayAnalysis,
  previousDayScore: number | null,
  currentWeekly: WeeklyRecord | null,
  monthlyRecords: MonthlyRecord[],
): void {
  const diff = previousDayScore !== null ? analysis.avgScore - previousDayScore : null;

  console.log('');
  console.log(chalk.bold.cyan(DIVIDER));
  console.log(chalk.bold.cyan(`  PromptIQ · ${analysis.date}`));
  console.log(chalk.bold.cyan(DIVIDER));
  console.log('');
  console.log(`  Analyzed ${chalk.bold(String(analysis.promptCount))} prompts`);
  console.log('');

  // Score line
  const scoreStr = scoreBadge(analysis.avgScore);
  const diffStr =
    diff !== null
      ? diffBadge(diff)
      : chalk.gray('  First analysis — no previous day to compare.');
  console.log(`  Today's Score:  ${scoreStr}  ${diffStr}`);
  console.log('');

  // Patterns
  if (analysis.patterns.length > 0) {
    console.log(chalk.bold('  Patterns Detected'));
    for (const p of analysis.patterns) {
      const upDown =
        diff !== null && diff < 0 ? chalk.red('↑ worsening trend') : chalk.green('↓ resolved trend');
      console.log(
        `  ${chalk.yellow('●')} ${p.label.padEnd(28)} ${String(p.frequency).padStart(2)} of ${analysis.promptCount} prompts  (${upDown})`,
      );
    }
    console.log('');
  }

  // Suggestions
  if (analysis.suggestions.length > 0) {
    console.log(chalk.bold('  Top Suggestions'));
    analysis.suggestions.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.text}`);
      if (s.before) console.log(`     ${chalk.dim('Before:')} ${chalk.italic(s.before)}`);
      if (s.after) console.log(`     ${chalk.dim('After: ')} ${chalk.italic(s.after)}`);
      if (i < analysis.suggestions.length - 1) console.log('');
    });
    console.log('');
  }

  // Weekly trend
  if (currentWeekly && currentWeekly.detail === 'daily') {
    const days = (currentWeekly as WeeklyRecordDaily).days;
    const dayEntries = Object.entries(days).sort(([a], [b]) => a.localeCompare(b));
    if (dayEntries.length > 0) {
      console.log(chalk.bold(`  Weekly Trend (${currentWeekly.week})`));
      const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const parts = dayEntries.map(([date, d]) => {
        const dayOfWeek = new Date(date + 'T12:00:00Z').getUTCDay();
        const label = DAY_LABELS[dayOfWeek];
        return `${label} ${scoreBadge(d.avgScore)}`;
      });
      console.log(`  ${parts.join('  ')}`);
      console.log('');
    }
  }

  // Long-term patterns from monthly
  const allPersistent = monthlyRecords.flatMap(m =>
    m.persistentPatterns.map(p => ({ pattern: p, month: m.month })),
  );
  const persistentCounts: Record<string, number> = {};
  for (const { pattern } of allPersistent) {
    persistentCounts[pattern] = (persistentCounts[pattern] ?? 0) + 1;
  }
  const topPersistent = Object.entries(persistentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (topPersistent.length > 0) {
    console.log(chalk.bold('  Long-term Patterns (from monthly memory)'));
    for (const [pattern, count] of topPersistent) {
      console.log(
        `  ${chalk.yellow('●')} ${pattern}  — seen for ${count}+ week${count === 1 ? '' : 's'}`,
      );
    }
    console.log('');
  }

  console.log(chalk.bold.cyan(DIVIDER));
  console.log('');
}

/**
 * Renders the `status` command output.
 */
export function renderStatus(
  todayCount: number,
  lastAnalysisDate: string | null,
  weeklyFiles: WeeklyRecord[],
  monthlyFiles: MonthlyRecord[],
): void {
  // Collect all days with error === true from daily-detail weekly files
  const failedDates: string[] = [];
  for (const w of weeklyFiles) {
    if (w.detail === 'daily') {
      for (const [date, d] of Object.entries((w as WeeklyRecordDaily).days)) {
        if (d.error) failedDates.push(date);
      }
    }
  }
  failedDates.sort();

  console.log('');
  console.log(chalk.bold('PromptIQ Status'));
  console.log(DIVIDER);
  console.log(`  Today's prompts logged:  ${chalk.bold(String(todayCount))}`);
  console.log(
    `  Last analysis:           ${lastAnalysisDate ? chalk.bold(lastAnalysisDate) : chalk.dim('never')}`,
  );
  console.log(`  Weekly summaries stored: ${chalk.bold(String(weeklyFiles.length))}`);
  console.log(`  Monthly summaries stored: ${chalk.bold(String(monthlyFiles.length))}`);
  if (failedDates.length > 0) {
    console.log(
      `  ${chalk.yellow('⚠')} ${chalk.yellow(`${failedDates.length} day${failedDates.length === 1 ? '' : 's'} failed to analyze`)}: ${failedDates.join(', ')}`,
    );
  }
  console.log('');
}

/**
 * Renders the `patterns` command output.
 */
export function renderPatterns(
  weeklyFiles: WeeklyRecord[],
  monthlyFiles: MonthlyRecord[],
): void {
  console.log('');
  console.log(chalk.bold('PromptIQ — Patterns'));
  console.log(DIVIDER);

  if (weeklyFiles.length === 0 && monthlyFiles.length === 0) {
    console.log(chalk.dim('  No historical data yet. Run `promptiq analyze` to start building memory.'));
    console.log('');
    return;
  }

  // Weekly patterns
  for (const w of weeklyFiles.slice().reverse()) {
    if (w.detail === 'compressed') {
      console.log(chalk.bold(`  ${w.week}`) + chalk.dim(' (compressed)'));
      console.log(`    Score: ${scoreBadge(w.avgScore)}  Prompts: ${w.promptCount}`);
      if (w.topPatterns.length > 0) {
        console.log(`    Top patterns: ${w.topPatterns.join(', ')}`);
      }
      console.log('');
    } else {
      const daily = w as WeeklyRecordDaily;
      console.log(chalk.bold(`  ${w.week}`) + chalk.dim(' (daily breakdown)'));
      for (const [date, d] of Object.entries(daily.days).sort()) {
        console.log(
          `    ${date}  Score: ${scoreBadge(d.avgScore)}  Prompts: ${d.promptCount}`,
        );
      }
      console.log('');
    }
  }

  // Monthly patterns
  for (const m of monthlyFiles.slice().reverse()) {
    console.log(chalk.bold(`  ${m.month}`) + chalk.dim(' (monthly)'));
    console.log(`    Score: ${scoreBadge(m.avgScore)}  Prompts: ${m.promptCount}  Weeks: ${m.weekCount}`);
    if (m.persistentPatterns.length > 0) {
      console.log(`    Persistent patterns: ${m.persistentPatterns.join(', ')}`);
    }
    console.log('');
  }

  console.log(DIVIDER);
  console.log('');
}

/**
 * Renders the `last` command output.
 */
export function renderLastPrompts(prompts: string[], n: number): void {
  console.log('');
  console.log(chalk.bold(`Last ${n} prompts`));
  console.log(DIVIDER);
  if (prompts.length === 0) {
    console.log(chalk.dim('  No prompts logged today.'));
  } else {
    prompts.forEach((p, i) => {
      console.log(`  ${chalk.dim(String(i + 1) + '.')} ${p}`);
    });
  }
  console.log('');
}
