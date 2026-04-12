# Working Log: 12-Factor Agent Improvements
**Date**: 2026-04-12
**Worktree**: .claude/worktrees/12-factor-improvements/
**Impl plan**: Implementation Plans/impl--2026-04-12--22-27--12-factor-improvements.md

## Changes Made
- `src/types.ts`: Added optional `error`, `errorType`, `errorMessage` fields to `WeekDayRecord` interface
- `src/drm.ts`: Added `buildHistoryContext()` exported function (returns DRM history as markdown for system prompt injection)
- `src/drm.ts`: Added `upsertErrorInWeekly()` exported function (writes error records to weekly file, guards against overwriting successful entries)
- `src/analyzer.ts`: Replaced `parseWithRetry` with Anthropic Tools API (`REPORT_ANALYSIS_TOOL`); updated `buildSystemPrompt` to accept `historyContext`; updated `analyzeToday` to call `buildHistoryContext()` and use `tool_choice: { type: 'tool', name: 'report_analysis' }`; added import of `buildHistoryContext` from `./drm.js`
- `src/logger.ts`: Updated `runLog(filePath?: string)` to accept optional file path parameter; renames internal `filePath` to `logPath` to avoid shadowing
- `src/cli.ts`: Added `--file <path>` option to `log` command; added `upsertErrorInWeekly` import; updated `analyze` catch block to call `upsertErrorInWeekly` before exiting
- `src/renderer.ts`: Updated `renderStatus` to scan weekly files for error days and display `⚠ N days failed to analyze` warning
- `src/test/analyzer.test.ts`: Updated mock to return `tool_use` block; added 3 new tests (tool_choice assertion, throws-if-no-tool_use, history section absent)
- `src/test/drm.test.ts`: Added 4 new tests (`buildHistoryContext` empty/with-file, `upsertErrorInWeekly` write/no-overwrite)
- `src/test/logger.test.ts`: Added 2 new tests (`runLog(filePath)` reads from file, throws when file missing)
- `src/test/renderer.test.ts`: New file — 2 tests for `renderStatus` error day display (with chalk mocked for CJS compatibility)
- `src/test/integration.test.ts`: Updated Anthropic mock to return `tool_use` block instead of `text` block

## Errors Encountered
- **Step 8 (renderer.test.ts)**: First attempt — chalk v5 is ESM-only, Jest/ts-jest runs CJS. Test suite failed to parse. Fix (attempt 2): Added `jest.mock('chalk', ...)` at the top of renderer.test.ts with an identity-function mock. This resolved the issue.
- **Step 8 (analyzer.test.ts "throws if no tool_use")**: First attempt used `mockResolvedValueOnce` on `mock.results[0]?.value` — but each `analyzeToday` call creates a new `Anthropic` instance, so the mockInstance from results[0] was not the instance used in the test. Fix (attempt 2): Used `mockImplementationOnce` on the mock constructor itself to return a single-use instance with `{ content: [] }`. This resolved the issue.

## Deviations from Plan
- **`npm run build` fails with `@rollup/rollup-linux-x64-gnu` error**: This is a pre-existing WSL limitation documented in CLAUDE.md ("the committed `dist/cli.js` is usable as-is"). The build failure is not caused by any changes in this implementation — confirmed by reproducing the same error in the main project before any changes.
- **renderer.test.ts required chalk mock**: The plan did not anticipate that chalk v5 (ESM-only) would need to be mocked for Jest CJS tests. Added `jest.mock('chalk', ...)` at the top of the new test file. This preserves the test's intent (verifying renderStatus output) without changing the jest config or package.json.
- **"throws if no tool_use" test restructured**: The plan suggested `mockResolvedValueOnce` on an existing instance. Due to per-call Anthropic instance creation, switched to `mockImplementationOnce` on the factory. Preserves test intent exactly.

## Verification
- Lint: OK (`npm run lint` exits 0)
- Build: FAILED — pre-existing WSL `@rollup/rollup-linux-x64-gnu` issue (not caused by this implementation)
- Tests: 33 passed, 0 failed (22 original + 11 new tests)
- `parseWithRetry` removed from `src/analyzer.ts`: confirmed (grep count = 0)
- `tools` and `tool_choice` in `client.messages.create` call: confirmed
- `buildHistoryContext()` exported from `src/drm.ts`: confirmed
- `upsertErrorInWeekly()` exported from `src/drm.ts`: confirmed
- `--file` option wired to `runLog(options.file)` in `cli.ts`: confirmed
- `upsertErrorInWeekly` called in analyze catch block: confirmed
- `renderStatus` shows `⚠ N days failed to analyze` for error days: confirmed via test
- No new npm dependencies added: confirmed
- All `.js` import extensions preserved: confirmed
