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

// The single most impactful improvement tip for the day
export interface MainTip {
  text: string;   // the actionable improvement (1-2 sentences)
  why: string;    // the rationale for why this matters (1-2 sentences)
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
  mainTip: MainTip;            // the single most impactful improvement
}

// Per-day record stored inside a weekly file (detail: "daily")
export interface WeekDayRecord {
  promptCount: number;
  avgScore: number;
  topPatterns: string[];
  summary: string;
  suggestions?: Suggestion[];   // from DayAnalysis.suggestions
  mainTip?: MainTip;            // optional — absent in records written before this feature
  actedOnTip?: boolean;         // user marked they acted on the tip for this day
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
  patternFrequency: Record<string, number>;  // tracks cross-week occurrence counts
  summary: string;
}

// ─── Spot Analyzer types ───────────────────────────────────────────────────

export interface CriterionScore {
  criterion: string;  // e.g. "Specificity" — from rubric H3 heading
  score: number;      // 0–1
  weight: number;     // from rubric, e.g. 0.30
}

export interface SpotSuggestion {
  criterion: string;  // which rubric criterion this targets
  issue: string;      // what's weak (1 sentence)
  fix: string;        // what to change (1 sentence)
}

export interface SpotAnalysis {
  overallScore: number;               // weighted mean of criterion scores
  criterionScores: CriterionScore[];  // one entry per rubric criterion
  patterns: string[];                 // detected pattern ids
  suggestions: SpotSuggestion[];      // max 3, ordered by impact
  improvedPrompt: string;             // full rewritten prompt
  improvementReasons: string[];       // parallel to suggestions[], one line per change
}
