import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import type { LogEntry } from './types.js';

/**
 * Returns the path to the promptiq data directory.
 * Checks PROMPTIQ_HOME env var first (used in tests), then falls back to ~/.promptiq.
 */
export function promptiqDir(): string {
  if (process.env.PROMPTIQ_HOME) {
    return path.join(process.env.PROMPTIQ_HOME, '.promptiq');
  }
  return path.join(os.homedir(), '.promptiq');
}

function dailyDir(): string {
  return path.join(promptiqDir(), 'daily');
}

/**
 * Ensures ~/.promptiq/ and subdirectories exist.
 * Also copies default rubric on first run.
 */
export function ensureDirectories(): void {
  fs.mkdirSync(dailyDir(), { recursive: true });
  fs.mkdirSync(path.join(promptiqDir(), 'weekly'), { recursive: true });
  fs.mkdirSync(path.join(promptiqDir(), 'monthly'), { recursive: true });
}

/**
 * Returns the path for today's daily log file.
 */
export function todayLogPath(): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(dailyDir(), `${today}.jsonl`);
}

/**
 * Returns all log entries from today's .jsonl file.
 * Skips malformed lines with a warning.
 */
export function readTodayEntries(): LogEntry[] {
  const filePath = todayLogPath();
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
  const entries: LogEntry[] = [];
  let skipped = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (entry.timestamp && entry.prompt) {
        entries.push(entry);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  if (skipped > 0) {
    console.warn(`Warning: skipped ${skipped} malformed line(s) in ${filePath}`);
  }

  return entries;
}

/**
 * Reads entries from a specific daily log file by date string (YYYY-MM-DD).
 * Skips malformed lines with a warning.
 */
export function readEntriesForDate(date: string): LogEntry[] {
  const filePath = path.join(dailyDir(), `${date}.jsonl`);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
  const entries: LogEntry[] = [];
  let skipped = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (entry.timestamp && entry.prompt) {
        entries.push(entry);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  if (skipped > 0) {
    console.warn(`Warning: skipped ${skipped} malformed line(s) in ${filePath}`);
  }

  return entries;
}

/**
 * Returns all existing daily log file date strings (YYYY-MM-DD), sorted ascending.
 */
export function listDailyDates(): string[] {
  if (!fs.existsSync(dailyDir())) return [];
  return fs
    .readdirSync(dailyDir())
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''))
    .sort();
}

/**
 * Deletes a daily log file by date string. Used by DRM rollup ONLY after
 * the weekly entry has been successfully written.
 */
export function deleteDailyFile(date: string): void {
  const filePath = path.join(dailyDir(), `${date}.jsonl`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Main entry for `promptiq log` command.
 * Reads prompt from stdin, appends as JSON line to today's daily file.
 * Fast: no API calls, disk write only.
 */
export async function runLog(): Promise<void> {
  ensureDirectories();

  // Read all stdin
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  const prompt = lines.join('\n').trim();

  if (!prompt) return; // Nothing to log

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    prompt,
  };

  const filePath = todayLogPath();
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}
