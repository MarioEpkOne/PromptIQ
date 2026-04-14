<!-- last-commit: aea1bf4aff6a8f5d2b99e556f539e4e2faee708e -->
# Patch Notes

## v0.2.0 — 2026-04-15
Added on-demand Analyzer tab and Analyze button for single-prompt and batch analysis. Rubric and analyzed prompts are now wrapped in XML tags with `escapeXml()` escaping, preventing prompt injection from user-authored rubric files.

## v0.1.1 — 2026-04-15
Fixed a bug where the Analyze button re-analyzed all of today's prompts on every run. Now only prompts logged since the last analysis are sent to the LLM.

## v0.1.0 — 2026-04-14
Initial release. Includes prompt logging, rubric-based daily analysis, DRM weekly/monthly rollup, web dashboard (Status/Patterns/Weekly tabs), on-demand spot analyzer, MCP server, slash-command classifier, tip tracking, and feedback correlation.
