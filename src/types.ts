// Raw logged prompt entry (one line in daily .jsonl)
export interface LogEntry {
  timestamp: string;   // ISO 8601
  prompt: string;
}

// Rubric criterion parsed from rubric.md
export interface RubricCriterion {
  name: string;
  weight: number;
  description: string;
}

// Parsed rubric
export interface Rubric {
  criteria: RubricCriterion[];
  rawText: string;     // full file text, passed to LLM as system prompt section
}

// Per-prompt score from analyzer
export interface PromptScore {
  prompt: string;
  score: number;               // weighted composite 0-1
  weakestCriterion: string;    // which rubric criterion failed most
}

// Recurring pattern detected across a batch of prompts
export interface Pattern {
  id: string;
  label: string;
  frequency: number;           // how many prompts showed this pattern
  example: string;             // worst offender from today
}

// Actionable suggestion produced by the analyzer
export interface Suggestion {
  patternId: string;
  text: string;
  before?: string;             // example of a weak prompt
  after?: string;              // example of improved version
}

// Full analysis result for one day
export interface DayAnalysis {
  date: string;                // YYYY-MM-DD
  promptCount: number;
  avgScore: number;
  scores: PromptScore[];
  patterns: Pattern[];
  suggestions: Suggestion[];
  summary: string;             // prose summary for DRM storage
}

// Per-day record stored inside a weekly file (detail: "daily")
export interface WeekDayRecord {
  promptCount: number;
  avgScore: number;
  topPatterns: string[];
  summary: string;
  suggestions?: Suggestion[];   // from DayAnalysis.suggestions
  // Error fields (only present when analysis failed)
  error?: boolean;
  errorType?: string;
  errorMessage?: string;
}

// Weekly DRM record with daily breakdown (most recent full week)
export interface WeeklyRecordDaily {
  week: string;                // e.g. "2026-W15"
  startDate: string;           // YYYY-MM-DD
  endDate: string;             // YYYY-MM-DD
  detail: 'daily';
  days: Record<string, WeekDayRecord>;
}

// Weekly DRM record compressed (older weeks)
export interface WeeklyRecordCompressed {
  week: string;
  startDate: string;
  endDate: string;
  detail: 'compressed';
  promptCount: number;
  avgScore: number;
  topPatterns: string[];
  summary: string;
}

export type WeeklyRecord = WeeklyRecordDaily | WeeklyRecordCompressed;

// Monthly DRM record (final resolution floor)
export interface MonthlyRecord {
  month: string;               // e.g. "2026-03"
  weekCount: number;
  promptCount: number;
  avgScore: number;
  persistentPatterns: string[];
  summary: string;
}
