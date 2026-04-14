<!-- last-commit: aea1bf4aff6a8f5d2b99e556f539e4e2faee708e -->
# Patch Notes

## v0.2.0 — 2026-04-15

### fix: update rubric XML test to use 3-criteria fixture as spec prescribes
Updated the `buildSystemPrompt` rubric-wrapping test in `analyzer.test.ts` to use a local 3-criteria rubric fixture and assert `criteria="3"`, matching the spec exactly. Also corrected mock instance lookup to use `mock.results.at(-1)?.value` for test isolation.

### wrap rubric and analyzed prompt in XML tags for structured injection
Both `analyzeToday()` and `analyzePromptSpot()` now wrap the injected rubric in `<rubric criteria="N">` tags and the analyzed prompt in `<prompt index="1">` tags. All injected content is escaped via `escapeXml()`, preventing prompt injection from user-authored rubric files and multi-line prompts with special characters.

### add sinceCount, last analysis time, and fix test mocks for analyze button
The Analyze button in the Status tab now shows how many prompts have been captured since the last analysis and displays the last-analysis timestamp. Test mocks for the analyze flow were corrected to match the real API shape.

### add Analyze button to Status tab for on-demand analysis
A new Analyze button on the Status tab triggers an on-demand `analyzeToday()` run from the dashboard UI, with a loading spinner and result feedback. No scheduled analysis required.

### add missing computeDiff tests and integration test for spot analyzer
Added unit tests for `computeDiff()` edge cases and an integration-style test covering the full `analyzePromptSpot()` call path through the MCP tool handler.

### add Analyzer tab for on-demand single-prompt analysis
New Analyzer tab in the dashboard allows pasting any prompt and running a single-prompt analysis via `analyzePromptSpot()`. Returns per-criterion scores, patterns, improvements, and a rewritten prompt. Backed by a new `spot-analyzer.ts` module.

### add production-ready README with 12-factor agents coverage
Added a comprehensive README covering installation, CLI usage, MCP integration, architecture overview, and alignment with the 12-factor agent principles.

### bump max_tokens to 8000 and switch to Nunito font in dashboard
Increased `max_tokens` ceiling to 8000 for longer rubrics and response payloads. Switched the dashboard font to Nunito for improved readability.

### add mainTip to DayAnalysis fixtures in drm.test.ts
Test fixtures for `DayAnalysis` now include the `mainTip` field to keep them in sync with the updated type, preventing false test failures.

### add mainTip field to day analysis — single most impactful improvement tip
`DayAnalysis` and the weekly synthesis output now include a `mainTip` field: one high-leverage improvement with an explanation of its impact. Surfaced in the dashboard Status and Patterns tabs.

### classify and exclude control prompts from analysis
Prompts matching known control patterns (short commands, navigation, single-word inputs) are now classified as control prompts and excluded from scoring. Reduces noise in quality metrics and weekly synthesis.

### correct five data/UX bugs (W1–W5)
Fixed five bugs across the analyzer and dashboard: cross-week `previousDayScore` fallback (W2), stale cache on re-analysis (W3), score display precision (W4), pattern frequency overcounting (W1), and an edge case in the weekly summary window (W5).

### add W2 Monday→Sunday cross-week previousDayScore fallback test
Added a regression test for the Monday edge case where `previousDayScore` must look back to the prior week's Sunday record rather than failing silently.

### clarify tool schema descriptions and restore max_tokens to 8192
Improved description strings in the MCP tool schemas for clearer model guidance. Reverted a `max_tokens` regression introduced in a prior commit.

### reduce analyze token cost (sonnet, no history injection, truncation, weekly synthesis)
Switched the daily analyzer to `claude-sonnet` for cost reduction, removed historical context injection from `analyzeToday()` (now handled at synthesis time), added prompt truncation for very long inputs, and introduced `synthesizeWeek()` for compressed weekly summaries stored in DRM.

### add individual day rows with detail panel to Patterns tab
The Patterns tab now renders a row per analyzed day with score, tip, and a collapsible detail panel showing per-criterion scores and patterns. Replaced the previous flat list view.

### repair broken onclick on Patterns rows
Fixed a JavaScript error that prevented the detail panel from toggling on Patterns tab rows due to a missing event binding after a DOM re-render.

### add clickable detail panels to Patterns tab
Patterns tab rows are now clickable and expand an inline detail panel with the full analysis breakdown for that day — criteria scores, patterns, suggestions, and the rewritten prompt.

### add web UI dashboard, catchup analysis, and startup scheduling
Introduced a local web dashboard (served by the MCP server) with Status, Patterns, and History tabs. Added catchup analysis on startup for days missed since the last run, and a configurable daily analysis schedule.

### implement 12-factor agent improvements (F3, F4, F9, F11)
Applied four 12-factor agent principles: structured output via tool-use (F3), idempotent DRM writes (F4), explicit prompt versioning (F9), and graceful degradation on API failure (F11).

### initial PromptIQ implementation
First working implementation of PromptIQ: MCP server that hooks into Claude Code, captures prompts to a daily log, scores them against a user-defined rubric using Claude, and stores results in a date-keyed DRM file.
