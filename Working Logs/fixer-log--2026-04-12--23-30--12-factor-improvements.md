# Fixer Log
**Date**: 2026-04-12
**Audit**: Retros/audit-impl--2026-04-12--23-30--12-factor-improvements.md
**Impl plan**: Implementation Plans/impl--2026-04-12--22-27--12-factor-improvements.md

## Fixes Applied

- `src/test/drm.test.ts`: Extended `buildHistoryContext includes weekly entry when weekly file exists` to also seed a `MonthlyRecord` file at `monthly/2026-03.json` (150 prompts, avgScore 0.68, summary present). Added assertions that `result` contains `### Monthly summaries`, `2026-03`, `150 prompts`, and `0.68`. All 33 tests pass; monthly data path is now exercised and asserted.

## Skipped (Not Actionable)

- N/A

## Skipped (Fix Failed)

- N/A

## Deferred to User

- **Error 1: `dist/cli.js` not updated** — The build fails in WSL due to a missing `@rollup/rollup-linux-x64-gnu` native binary. This is a pre-existing environment limitation documented in CLAUDE.md ("rollup native binaries can fail to install on WSL"). `dist/cli.js` cannot be auto-generated in this environment and must not be hand-edited (it is auto-generated). To resolve: run `npm run build` on a non-WSL machine (Windows native Node or a Linux VM), then copy `dist/cli.js` into the worktree and commit it before merging.
