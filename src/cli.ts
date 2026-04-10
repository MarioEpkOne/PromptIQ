#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';

import { runLog, readTodayEntries, ensureDirectories } from './logger.js';
import { loadRubric, copyDefaultRubric, rubricPath } from './rubric.js';
import { analyzeToday } from './analyzer.js';
import { runRollup, upsertDayInWeekly, getDrmSummary, isoWeekLabel } from './drm.js';
import {
  renderAnalysis,
  renderStatus,
  renderPatterns,
  renderLastPrompts,
} from './renderer.js';
import type { WeeklyRecordDaily } from './types.js';

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
  .addHelpText('after', '\nNote: This command is intended to be called by the Claude Code hook system.')
  .action(async () => {
    try {
      await runLog();
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
      console.error(`Analysis failed: ${String(err)}`);
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

program.parse(process.argv);
