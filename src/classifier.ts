import * as fs from 'fs';
import * as path from 'path';
import { promptiqDir } from './logger.js';
import type { LogEntry } from './types.js';

export interface ClassifierConfig {
  additionalPatterns?: string[];    // extra regex strings to compile and add
  excludeDefaults?: boolean;        // if true, only additionalPatterns are used
}

const CONTROL_LENGTH_THRESHOLD = 10;

// Anchored regexes — match only pure control prompts (no trailing task content)
const DEFAULT_CONTROL_PATTERNS: RegExp[] = [
  /^(yes|no|ok|okay|y|n|yep|nope|sure|fine|right|correct|agreed|approve|approved|done)\s*[.!?]*$/i,
  /^(perfect|great|cool|awesome|nice|good)\s*[.!?]*$/i,
  /^go\s+ahead\s*[.!?]*$/i,
  /^looks?\s+good\s*[.!?]*$/i,
  /^sounds?\s+good\s*[.!?]*$/i,
  /^that'?s?\s+(good|fine|right|correct|ok|okay)\s*[.!?]*$/i,
  /^(proceed|continue)\s*[.!?]*$/i,
  /^(carry|move)\s+on\s*[.!?]*$/i,
  /^lgtm\s*[.!?]*$/i,
  /^[👍👎✅❌🙏]+$/u,
];

export function classifierConfigPath(): string {
  return path.join(promptiqDir(), 'classifier.json');
}

export function loadClassifierConfig(): ClassifierConfig {
  const p = classifierConfigPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ClassifierConfig;
  } catch {
    console.warn('Warning: classifier.json is malformed — using defaults.');
    return {};
  }
}

export function isControlPrompt(prompt: string, patterns: RegExp[]): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length <= CONTROL_LENGTH_THRESHOLD) return true;
  return patterns.some(re => re.test(trimmed));
}

export function buildPatterns(config: ClassifierConfig): RegExp[] {
  const base = config.excludeDefaults ? [] : [...DEFAULT_CONTROL_PATTERNS];
  const extra: RegExp[] = [];
  for (const p of config.additionalPatterns ?? []) {
    try {
      extra.push(new RegExp(p, 'i'));
    } catch {
      console.warn(`Warning: classifier.json contains invalid regex pattern "${p}" — skipping.`);
    }
  }
  return [...base, ...extra];
}

export function classifyEntries(
  entries: LogEntry[],
  config: ClassifierConfig = {},
): { taskEntries: LogEntry[]; controlCount: number } {
  const patterns = buildPatterns(config);
  const taskEntries = entries.filter(e => !isControlPrompt(e.prompt, patterns));
  return { taskEntries, controlCount: entries.length - taskEntries.length };
}
