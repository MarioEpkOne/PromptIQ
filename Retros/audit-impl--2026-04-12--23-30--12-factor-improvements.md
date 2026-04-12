# Implementation Audit: 12-Factor Agent Improvements
**Date**: 2026-04-12
**Status**: COMPLETE (with one build caveat)
**Working log**: Working Logs/wlog--2026-04-12--22-50--12-factor-improvements.md
**Impl plan**: Implementation Plans/impl--2026-04-12--22-27--12-factor-improvements.md
**Spec**: specs/spec--2026-04-12--22-27--12-factor-improvements.md

---

## Independent Evaluator Verdict

Independent evaluation was adapted to a code-review mode (no MCP / Unity tools apply here — this is a TypeScript CLI project). The evaluator read the spec, then inspected all changed source files and test files in the worktree directly, independent of the working log, to determine whether each spec goal is met.

---

## Goals — Static Verification

| Goal | Status | Evidence |
|---|---|---|
| F4-1: Replace `parseWithRetry` with tools API (`tool_choice: { type: 'tool', name: 'report_analysis' }`) | APPEARS MET | `parseWithRetry` grep returns 0 hits; `client.messages.create` now passes `tools: [REPORT_ANALYSIS_TOOL]` and `tool_choice: { type: 'tool', name: 'report_analysis' }` (analyzer.ts:126-133) |
| F4-2: Tool name `report_analysis`, schema mirrors existing JSON shape | APPEARS MET | `REPORT_ANALYSIS_TOOL` defined at analyzer.ts:45-93 with `scores`, `patterns`, `suggestions`, `summary` properties and correct required fields |
| F4-3: Model stays `claude-opus-4-5` | APPEARS MET | analyzer.ts:127 |
| F3-1: Inject all available MonthlyRecord + WeeklyRecord files (no cap) | APPEARS MET | `buildHistoryContext()` in drm.ts:441 reads all files via `getDrmSummary()`, no cap applied |
| F3-2: Inject as `## Historical Context` section in `buildSystemPrompt()` after rubric | APPEARS MET | analyzer.ts:11-17: `historySec` appended immediately after `${rubric.rawText}` |
| F3-3: If no history exists, section omitted entirely | APPEARS MET | `historyContext ? \`\n${historyContext}\n\` : ''` — empty string from `buildHistoryContext()` when no files exist |
| F9-1: On analysis failure, write error `WeekDayRecord` to weekly file | APPEARS MET | cli.ts:81-85 calls `upsertErrorInWeekly(today, entries.length, errorType, errorMessage)` in catch block |
| F9-2: Extend `WeekDayRecord` with optional `error?`, `errorType?`, `errorMessage?` | APPEARS MET | types.ts:60-63 |
| F9-3: `promptiq status` surfaces "N days failed to analyze" | APPEARS MET | renderer.ts:129-153 scans weekly files for `error === true` and prints `⚠ N day(s) failed to analyze: [dates]` |
| F11-1: Add `--file <path>` to `promptiq log` in cli.ts | APPEARS MET | cli.ts:33: `.option('--file <path>', 'Read prompt from file instead of stdin')` |
| F11-2: `runLog()` gains optional `filePath?: string` | APPEARS MET | logger.ts:132 |
| F11-3: File contents stored identically to stdin-sourced prompt | APPEARS MET | logger.ts:137-139: `fs.readFileSync(filePath, 'utf-8').trim()` — same trim and JSON append path as stdin |
| F11-4: Hook contract not violated (stdin fallback preserved) | APPEARS MET | `else` branch at logger.ts:140-148 preserves original stdin read |
| Build exits 0 | APPEARS UNMET | `npm run build` fails due to `@rollup/rollup-linux-x64-gnu` missing native binary (WSL); `dist/cli.js` does NOT reflect new features |
| All 22 existing tests pass | APPEARS MET | `npm test`: 33 passed, 0 failed |
| New tests cover all new behaviors | MOSTLY MET | 11 new tests; one spec-listed test ("buildHistoryContext includes monthly + weekly entries") only verifies a weekly file — monthly path is covered by code but not asserted in this test |

## Properties Not Verifiable Without Play Mode

Not applicable — this is a TypeScript CLI project. No runtime/play-mode distinction applies.

---

## Failures & Root Causes

### Build not updated in worktree
**Category**: `INCOMPLETE_TASK`
**What happened**: `npm run build` fails in the WSL environment due to a missing `@rollup/rollup-linux-x64-gnu` native binary. The working log documents this as a pre-existing limitation noted in CLAUDE.md. No `dist/` directory exists in the worktree; the main repo's `dist/cli.js` is stale and does not contain any of the four implemented factors.
**Why**: The WSL native binary issue is environment-specific and pre-existing, but the spec explicitly states "`npm run build` must exit 0" as a requirement. Since the distributed binary is the actual runtime artifact, users running `promptiq` via `dist/cli.js` will not benefit from any of the Factor 3, 4, 9, or 11 changes.
**Evidence**: `grep -c "buildHistoryContext|upsertErrorInWeekly|tool_choice|report_analysis" dist/cli.js` → 0. Working log confirms: "Build: FAILED — pre-existing WSL `@rollup/rollup-linux-x64-gnu` issue."

### Test coverage gap: `buildHistoryContext` monthly path not asserted
**Category**: `INCOMPLETE_TASK`
**What happened**: The spec's testing strategy table lists the test "buildHistoryContext() includes monthly + weekly entries" as a new test to cover Factor 3. The implemented test `buildHistoryContext includes weekly entry when weekly file exists` (drm.test.ts:132) writes only a compressed weekly file and makes no assertions about monthly data formatting.
**Why**: The test description implies monthly entries should also be included in the assertion, but the test only writes and verifies a weekly record. The monthly formatting code path in `buildHistoryContext` is exercised by the code but not by any test.
**Evidence**: drm.test.ts:132-159 — only `weeklyDir` files written; no `monthlyDir` file written; no assertion on `### Monthly summaries` section.

---

## Verification Gaps

None. This is a TypeScript CLI project with no MCP/runtime verification concerns.

---

## Actionable Errors

### Error 1: `dist/cli.js` not updated — new features unreachable via distributed binary
- **Category**: `INCOMPLETE_TASK`
- **File(s)**: `dist/cli.js` (main project root, not worktree)
- **What broke**: The spec requires `npm run build` to exit 0. It fails. The committed `dist/cli.js` does not include any changes from this implementation (Tools API, DRM history injection, error records, `--file` flag). Any user running `promptiq` via the binary will not have these features.
- **Evidence**: `grep -c "report_analysis" /mnt/c/Users/Epkone/promptiq/dist/cli.js` → 0. `npm run build` exits with rollup native binary error.
- **Suggested fix**: On a non-WSL machine (or after resolving the rollup binary), run `npm run build` and commit the updated `dist/cli.js`. Alternatively, on WSL: `npm install --platform=linux --arch=x64` or `npm rebuild` to force-install the correct rollup binary, then build.

### Error 2: `buildHistoryContext` test does not cover monthly summary path
- **Category**: `INCOMPLETE_TASK`
- **File(s)**: `src/test/drm.test.ts`
- **What broke**: Spec test table requires "buildHistoryContext() includes monthly + weekly entries." The test only writes a weekly file; the `### Monthly summaries` section of `buildHistoryContext` output is never exercised in tests.
- **Evidence**: drm.test.ts:132-159 — only `weeklyDir` file written; no assertion on `Monthly summaries`.
- **Suggested fix**: Extend the existing test to also write a monthly JSON file into `monthlyDir` and assert the output contains `### Monthly summaries` and the monthly record fields (`promptCount`, `avgScore`, `summary`).

**Not actionable (requires human judgment or play-mode verification):**
- The `upsertErrorInWeekly` compressed-week guard (returns without writing when week is already compressed) is a reasonable implementation choice not explicitly spec'd. The spec only requires the guard against overwriting a successful daily-detail entry. This is not an error but a design decision the implementer made; no change is required.
- The `historySec` placement in `buildSystemPrompt` appends history directly after `rubric.rawText` without an explicit blank line separator (only `\n` prefix). If `rubric.rawText` already ends with `\n`, the section will have a single blank line; if not, the `## Historical Context` header will be on the line immediately after the rubric text. This is cosmetically imperfect but functionally correct for the LLM.

## Rule Violations

None. All CLAUDE.md hard rules were observed:
- No new npm dependencies added
- Import extensions preserved as `.js`
- `__dirname` / CJS not changed
- Hook contract preserved (exits 0, no network calls)
- DRM invariant preserved (`upsertErrorInWeekly` does not delete daily file)

## Task Completeness
- **Unchecked items**: None listed in the working log Post-Implementation Checklist
- **De-facto unchecked**: `npm run build` exits 0 — explicitly failed and acknowledged

---

## Proposed Skill Changes

### CLAUDE.md — Document build-before-commit requirement for WSL workarounds

**Insert after**: `## Gotchas` → `rollup` native binaries paragraph
```diff
+ **Build must be committed**: When `npm run build` is run on a non-WSL machine,
+ the updated `dist/cli.js` must be committed before merging a feature branch.
+ If the build cannot run in WSL, build on Windows or in a Linux VM, then copy
+ `dist/cli.js` into the worktree and commit it. The spec requirement "`npm run build`
+ must exit 0" is satisfied only when the distributable binary reflects all source changes.
```
**Why**: Prevents future implementations from shipping source-only changes with a stale binary. The build constraint was known at spec time but the implementing agent accepted the pre-existing WSL failure without producing an updated binary through any alternative path.
[ ] Apply?

---

## Proposed learnings.md Additions
Copy-paste these into learnings.md under the relevant section:

```
- 2026-04-12 [12-factor-improvements]: When a build tool cannot run in the CI/dev environment (e.g. rollup on WSL), the agent must either find an alternative build path or explicitly flag the distributable as stale — not silently accept a known build failure. A spec-required build that fails = INCOMPLETE_TASK. → impl.md, impl-plan.md

- 2026-04-12 [12-factor-improvements]: When a spec test table says "includes X + Y entries," write a test that actually seeds and asserts both X and Y data paths. A test that only covers one of the two listed inputs is incomplete coverage. → impl.md testing section
```

---

## Re-Audit (after fix loop 1)
**Date**: 2026-04-13
**Status**: COMPLETE (with one deferred build caveat)

### What the fixer did
- **Error 1** (`dist/cli.js` stale): Deferred — WSL build is a pre-existing limitation documented in CLAUDE.md. No change made.
- **Error 2** (`buildHistoryContext` monthly test gap): Fixed — extended `buildHistoryContext includes weekly entry when weekly file exists` in `src/test/drm.test.ts` to seed a monthly file and assert `### Monthly summaries`, `2026-03`, `150 prompts`, and `0.68` appear in output.

### Updated Goals — Static Verification

| Goal | Status | Evidence |
|---|---|---|
| `buildHistoryContext` monthly path covered by test | APPEARS MET | drm.test.ts:154-178: monthly file seeded; `### Monthly summaries`, `2026-03`, `150 prompts`, `0.68` all asserted |
| All other goals | unchanged — still APPEARS MET (see above) | |
| Build exits 0 | APPEARS UNMET | WSL pre-existing issue, deferred — see Error 1 above |

### Test Suite
All 33 tests pass (22 original + 11 new), 0 failures. Lint: `npm run lint` exits 0.

### Remaining Actionable Errors

**Error 1: `dist/cli.js` not updated** — still open. Build on a non-WSL machine and commit the updated binary before this branch is considered fully shipped.

**Error 2**: RESOLVED.
