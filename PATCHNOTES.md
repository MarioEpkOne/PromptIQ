<!-- last-commit: 9830f2523783f31503ab06e9438af600b6b7e135 -->
# Patch Notes

## v0.3.0 — 2026-04-15
Switched prompt batch serialization and week-day entries to XML tags (`<prompt index="N">`, `<day date="…">`), improving scoring consistency and reducing prompt misattribution. Fixed the Analyzer tab's before/after examples and `improvedPrompt` output to generate natural English instead of mechanical rewrites, and bumped the spot-analyzer token limit to avoid truncation. Also fixed `promptiq serve` to default to port 80, corrected a regex escape in the dashboard diff view, and resolved a home-directory bug that caused the dashboard to show no history when started with `sudo`.

## v0.2.0 — 2026-04-15
Added on-demand Analyzer tab and Analyze button for single-prompt and batch analysis. Rubric and analyzed prompts are now wrapped in XML tags with `escapeXml()` escaping, preventing prompt injection from user-authored rubric files.

## v0.1.1 — 2026-04-15
Fixed a bug where the Analyze button re-analyzed all of today's prompts on every run. Now only prompts logged since the last analysis are sent to the LLM.

## v0.1.0 — 2026-04-14
Initial release. Includes prompt logging, rubric-based daily analysis, DRM weekly/monthly rollup, web dashboard (Status/Patterns/Weekly tabs), on-demand spot analyzer, MCP server, slash-command classifier, tip tracking, and feedback correlation.
