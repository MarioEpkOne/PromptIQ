#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';

import { runLog, readTodayEntries, readEntriesForDate, listDailyDates, ensureDirectories } from './logger.js';
import { loadRubric, copyDefaultRubric, rubricPath } from './rubric.js';
import { analyzeToday } from './analyzer.js';
import { runRollup, upsertDayInWeekly, upsertErrorInWeekly, getDrmSummary, isoWeekLabel } from './drm.js';
import {
  renderAnalysis,
  renderStatus,
  renderPatterns,
  renderLastPrompts,
} from './renderer.js';
import type { WeeklyRecordDaily, WeeklyRecordCompressed } from './types.js';
import { startServer } from './server.js';

// In CommonJS, __dirname is available as a global
// Resolve assets dir relative to compiled output (dist/) or source (src/)
const assetsDir = path.resolve(__dirname, '..', 'assets');

const program = new Command();

program
  .name('promptiq')
  .description('Prompt analytics CLI for Claude Code')
  .version('0.1.0');

// ---------------------------------------------------------------------------
// Internal command: log (hidden from help)
// ---------------------------------------------------------------------------
const logCommand = new Command('log')
  .description('Log a prompt from stdin (called by Claude Code hook — not for manual use)')
  .option('--file <path>', 'Read prompt from file instead of stdin')
  .addHelpText('after', '\nNote: This command is intended to be called by the Claude Code hook system.')
  .action(async (options: { file?: string }) => {
    try {
      await runLog(options.file);
    } catch (err) {
      // Silent failure — must not block Claude Code
      process.stderr.write(`promptiq log error: ${String(err)}\n`);
      process.exit(0); // exit 0 so Claude Code hook is not interrupted
    }
  });
program.addCommand(logCommand, { hidden: true });

// ---------------------------------------------------------------------------
// analyze
// ---------------------------------------------------------------------------
program
  .command('analyze')
  .description("Analyze today's prompts, update DRM, print rich output")
  .action(async () => {
    // Check API key early
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set. Export it in your shell profile.');
      process.exit(1);
    }

    ensureDirectories();
    copyDefaultRubric(assetsDir);

    const today = new Date().toISOString().split('T')[0];
    const entries = readTodayEntries();

    if (entries.length < 3) {
      console.log(
        `Not enough prompts today (need at least 3). Keep using Claude Code and try again.`,
      );
      process.exit(0);
    }

    let analysis;
    try {
      const rubric = loadRubric();
      analysis = await analyzeToday(entries, rubric, today);
    } catch (err) {
      // Do NOT delete today's daily file — preserve for retry
      const errorMessage = String(err);
      const errorType = err instanceof Error ? err.constructor.name : 'UnknownError';
      // Write structured error record so `promptiq status` can surface failed days
      try {
        upsertErrorInWeekly(today, entries.length, errorType, errorMessage);
      } catch {
        // If error record write fails, still proceed to exit
      }
      console.error(`Analysis failed: ${errorMessage}`);
      process.exit(1);
    }

    // Upsert today's result into weekly file
    upsertDayInWeekly(analysis);

    // Run DRM rollup (rolls up old files, compresses old weeks, merges old months)
    await runRollup();

    // Gather data for rendering
    const { weeklyFiles, monthlyFiles } = getDrmSummary();
    const todayWeekLabel = isoWeekLabel(today);
    const currentWeekly = weeklyFiles.find(w => w.week === todayWeekLabel) ?? null;

    // Find yesterday's score for diff
    const yesterday = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().split('T')[0];
    })();

    let previousDayScore: number | null = null;
    // Check current weekly file for yesterday
    if (currentWeekly && currentWeekly.detail === 'daily') {
      const days = (currentWeekly as WeeklyRecordDaily).days;
      if (yesterday in days) {
        previousDayScore = days[yesterday].avgScore;
      }
    }

    renderAnalysis(analysis, previousDayScore, currentWeekly, monthlyFiles);
  });

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------
program
  .command('status')
  .description("Show today's prompt count, last analysis date, DRM summary")
  .action(() => {
    ensureDirectories();

    const today = new Date().toISOString().split('T')[0];
    const entries = readTodayEntries();
    const todayCount = entries.length;

    // Find last analysis date from weekly files
    const { weeklyFiles, monthlyFiles } = getDrmSummary();
    let lastAnalysisDate: string | null = null;
    for (const w of weeklyFiles.slice().reverse()) {
      if (w.detail === 'daily') {
        const days = Object.keys((w as WeeklyRecordDaily).days).sort().reverse();
        if (days.length > 0) {
          lastAnalysisDate = days[0];
          break;
        }
      }
    }

    renderStatus(todayCount, lastAnalysisDate, weeklyFiles, monthlyFiles);
  });

// ---------------------------------------------------------------------------
// patterns
// ---------------------------------------------------------------------------
program
  .command('patterns')
  .description('Show patterns from weekly and monthly memory')
  .action(() => {
    ensureDirectories();
    const { weeklyFiles, monthlyFiles } = getDrmSummary();
    renderPatterns(weeklyFiles, monthlyFiles);
  });

// ---------------------------------------------------------------------------
// last
// ---------------------------------------------------------------------------
program
  .command('last [n]')
  .description('Print the last N logged prompts from today (default: 10)')
  .action((nStr?: string) => {
    ensureDirectories();
    const n = nStr ? parseInt(nStr, 10) : 10;
    const entries = readTodayEntries();
    const last = entries.slice(-n).map(e => e.prompt);
    renderLastPrompts(last, n);
  });

// ---------------------------------------------------------------------------
// rubric
// ---------------------------------------------------------------------------
program
  .command('rubric')
  .description('Open ~/.promptiq/rubric.md in $EDITOR')
  .action(() => {
    ensureDirectories();
    copyDefaultRubric(assetsDir);

    const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
    const { spawnSync } = require('child_process');
    const result = spawnSync(editor, [rubricPath()], { stdio: 'inherit' });
    if (result.error) {
      console.error(`Could not open editor: ${String(result.error)}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------
program
  .command('serve')
  .description('Start local web dashboard at http://localhost:4242')
  .option('-p, --port <number>', 'Port to listen on', '4242')
  .option('--no-open', 'Do not open the browser automatically (useful for background/startup use)')
  .action((options: { port: string; open: boolean }) => {
    ensureDirectories();
    const port = parseInt(process.env.PROMPTIQ_PORT ?? options.port, 10);
    const server = startServer(port);

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is in use. Try: PROMPTIQ_PORT=${port + 1} promptiq serve`);
      } else {
        console.error(`Server error: ${String(err)}`);
      }
      process.exit(1);
    });

    server.on('listening', () => {
      const url = `http://localhost:${port}`;
      console.log(`PromptIQ UI running at ${url}`);
      console.log('Press Ctrl+C to stop.');
      if (options.open !== false) {
        // Best-effort browser open: try xdg-open (Linux), then cmd.exe /c start (WSL→Windows), then silent
        const { exec } = require('child_process') as typeof import('child_process');
        exec(
          `xdg-open "${url}" 2>/dev/null || cmd.exe /c start "" "${url}" 2>/dev/null || true`,
          () => { /* ignore errors */ },
        );
      }
    });
  });

// ---------------------------------------------------------------------------
// catchup
// ---------------------------------------------------------------------------
program
  .command('catchup')
  .description('Analyze any past days that were missed (PC was off, cron did not run, etc.)')
  .action(async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set. Export it in your shell profile.');
      process.exit(1);
    }

    ensureDirectories();
    copyDefaultRubric(assetsDir);

    const today = new Date().toISOString().split('T')[0];

    // Collect dates already handled: either in a daily-detail weekly record (no error)
    // or falling inside a compressed week's date range.
    const analyzedDates = new Set<string>();
    const compressedRanges: Array<{ start: string; end: string }> = [];

    const { weeklyFiles } = getDrmSummary();
    for (const w of weeklyFiles) {
      if (w.detail === 'daily') {
        for (const [date, d] of Object.entries((w as WeeklyRecordDaily).days)) {
          if (!d.error) analyzedDates.add(date);
        }
      } else {
        compressedRanges.push({ start: (w as WeeklyRecordCompressed).startDate, end: (w as WeeklyRecordCompressed).endDate });
      }
    }

    const isHandled = (date: string): boolean =>
      analyzedDates.has(date) ||
      compressedRanges.some(r => date >= r.start && date <= r.end);

    // Find past daily files that haven't been handled yet
    const dailyDates = listDailyDates();
    const missedDates = dailyDates.filter(date => date < today && !isHandled(date));

    if (missedDates.length === 0) {
      console.log('Nothing to catch up on — all past days are already analyzed.');
      return;
    }

    console.log(`Found ${missedDates.length} unanalyzed day(s): ${missedDates.join(', ')}`);
    console.log('');

    const rubric = loadRubric();
    let analyzed = 0;
    let skipped = 0;
    let failed = 0;

    for (const date of missedDates) {
      const entries = readEntriesForDate(date);
      if (entries.length < 3) {
        console.log(`  Skipping ${date} — only ${entries.length} prompt(s) logged (need at least 3)`);
        skipped++;
        continue;
      }

      process.stdout.write(`  Analyzing ${date} (${entries.length} prompts)... `);
      try {
        const analysis = await analyzeToday(entries, rubric, date);
        upsertDayInWeekly(analysis);
        analyzed++;
        console.log(`score ${(analysis.avgScore * 100).toFixed(0)}`);
      } catch (err) {
        const errorMessage = String(err);
        const errorType = err instanceof Error ? err.constructor.name : 'UnknownError';
        try {
          upsertErrorInWeekly(date, entries.length, errorType, errorMessage);
        } catch { /* ignore */ }
        console.log(`FAILED — ${errorMessage}`);
        failed++;
      }
    }

    // Run rollup after all catch-up work
    if (analyzed > 0) {
      await runRollup();
    }

    console.log('');
    const parts = [`${analyzed} analyzed`];
    if (skipped > 0) parts.push(`${skipped} skipped (too few prompts)`);
    if (failed > 0) parts.push(`${failed} failed`);
    console.log(`Catch-up complete: ${parts.join(', ')}.`);
  });

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------
program
  .command('schedule')
  .description('Set up daily auto-analysis cron job (runs at 11pm)')
  .option('--time <HH:MM>', 'Time to run analysis daily (24h format)', '23:00')
  .option('--on-startup', 'Also run catch-up analysis + start web UI on machine boot (@reboot cron)')
  .option('--remove', 'Remove all scheduled PromptIQ jobs (daily + startup)')
  .action(async (options: { time: string; onStartup?: boolean; remove?: boolean }) => {
    const { execSync } = require('child_process') as typeof import('child_process');

    // Determine binary path
    let binaryPath: string;
    try {
      // process.argv[1] is the script path; in dist/ it's the full path
      binaryPath = require('path').resolve(process.argv[1]);
    } catch {
      try {
        binaryPath = execSync('which promptiq', { encoding: 'utf-8' }).trim();
      } catch {
        console.error('Could not determine promptiq binary path. Make sure promptiq is on your PATH.');
        process.exit(1);
      }
    }

    // Read existing crontab (empty on first use)
    let existing = '';
    try {
      existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' });
    } catch {
      existing = '';
    }

    const MARKER_DAILY = '# promptiq-auto-analyze';
    const MARKER_STARTUP = '# promptiq-startup';
    const lines = existing.split('\n');

    const writeCrontab = (content: string): void => {
      const spawnSync = require('child_process').spawnSync;
      const result = spawnSync('crontab', ['-'], {
        input: content,
        encoding: 'utf-8',
        stdio: ['pipe', 'inherit', 'inherit'],
      });
      if (result.status !== 0) throw new Error('crontab write failed');
    };

    if (options.remove) {
      const hasAny = lines.some(l => l.includes(MARKER_DAILY) || l.includes(MARKER_STARTUP));
      if (!hasAny) {
        console.log('No scheduled job found.');
        return;
      }
      const filtered = lines.filter(
        l => !l.includes(MARKER_DAILY) && !l.includes(MARKER_STARTUP),
      );
      const newCrontab = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      try {
        writeCrontab(newCrontab ? newCrontab + '\n' : '');
        console.log('PromptIQ scheduled jobs removed.');
      } catch (err) {
        console.error(`Failed to update crontab: ${String(err)}`);
        process.exit(1);
      }
      return;
    }

    // Parse time
    const timeParts = options.time.split(':');
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1] ?? '0', 10);
    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      console.error('Invalid time format. Use HH:MM in 24-hour format, e.g. 23:00');
      process.exit(1);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const envPrefix = apiKey ? `ANTHROPIC_API_KEY=${apiKey} ` : '';

    const newLines: string[] = [];

    // Daily analysis cron line
    if (lines.some(l => l.includes(MARKER_DAILY))) {
      console.log('Daily analysis already scheduled.');
    } else {
      const cronLine = `${minute} ${hour} * * * ${envPrefix}${binaryPath} analyze >> ~/.promptiq/analyze.log 2>&1 ${MARKER_DAILY}`;
      newLines.push(cronLine);
      console.log(`Daily analysis scheduled at ${options.time}: ${cronLine}`);
    }

    // Startup (catch-up + serve) cron line
    if (options.onStartup) {
      if (lines.some(l => l.includes(MARKER_STARTUP))) {
        console.log('Startup catch-up already scheduled.');
      } else {
        // @reboot: run catchup, then start serve in the background (no browser)
        const startupLine = `@reboot ${envPrefix}${binaryPath} catchup >> ~/.promptiq/startup.log 2>&1; nohup ${binaryPath} serve --no-open >> ~/.promptiq/serve.log 2>&1 & ${MARKER_STARTUP}`;
        newLines.push(startupLine);
        console.log(`Startup job added: catch-up + serve will run on machine boot.`);
      }
    }

    if (newLines.length === 0) {
      console.log('Nothing to add — all requested jobs already scheduled.');
      console.log('Use `promptiq schedule --remove` to remove.');
      return;
    }

    const newCrontab = (existing.trim() ? existing.trimEnd() + '\n' : '') + newLines.join('\n') + '\n';

    try {
      writeCrontab(newCrontab);
      console.log('');
      console.log('Note (WSL): cron must be running. If jobs do not fire, start cron with:');
      console.log('  sudo service cron start');
      console.log('To auto-start cron on WSL boot, add this to /etc/wsl.conf:');
      console.log('  [boot]');
      console.log('  command = service cron start');
      if (!apiKey) {
        console.log('');
        console.log('Warning: ANTHROPIC_API_KEY was not set in the current environment.');
        console.log('Add it to your shell profile and re-run `promptiq schedule` to embed it.');
      }
    } catch (err) {
      console.error(`Failed to update crontab: ${String(err)}`);
      console.error('If crontab is not available, install cron: sudo apt-get install cron');
      process.exit(1);
    }
  });

program.parse(process.argv);
