# Implementation Audit: 12-Factor Agent Improvements (Post-Fix Re-Audit)
**Date**: 2026-04-13
**Status**: COMPLETE (with one deferred build caveat)
**Working log**: Working Logs/wlog--2026-04-12--22-50--12-factor-improvements.md
**Impl plan**: Implementation Plans/impl--2026-04-12--22-27--12-factor-improvements.md
**Spec**: specs/spec--2026-04-12--22-27--12-factor-improvements.md
**Previous audit**: Retros/audit-impl--2026-04-12--23-30--12-factor-improvements.md

---

## Context

This is a re-audit after a fixer agent addressed the two actionable errors from the prior audit:

- **Error 1** (`dist/cli.js` stale): Deferred — WSL build is a pre-existing limitation documented in CLAUDE.md. No change made.
- **Error 2** (`buildHistoryContext` monthly test gap): Fixed — fixer extended `buildHistoryContext includes weekly entry when weekly file exists` in `src/test/drm.test.ts` to seed a monthly file and assert the `### Monthly summaries` section appears in output.

---

## Independent Evaluator Verdict

All spec goals were re-evaluated by reading the source and test files in the worktree directly, independent of the working log. No MCP/Unity tools apply (TypeScript CLI project).

---

## Goals — Static Verification

| Goal | Status | Evidence |
|---|---|---|
| F4-1: Replace `parseWithRetry` with tools API | APPEARS MET | `parseWithRetry` grep returns 0 hits; `client.messages.create` passes `tools: [REPORT_ANALYSIS_TOOL]` and `tool_choice: { type: 'tool', name: 'report_analysis' }` (analyzer.ts:126-133) |
| F4-2: Tool name `report_analysis`, schema mirrors existing JSON shape | APPEARS MET | `REPORT_ANALYSIS_TOOL` defined at analyzer.ts:45-93 with `scores`, `patterns`, `suggestions`, `summary` as required fields |
| F4-3: Model stays `claude-opus-4-5` | APPEARS MET | analyzer.ts:127 |
| F3-1: Inject all available monthly + weekly records (no cap) | APPEARS MET | `buildHistoryContext()` at drm.ts:441 reads all files via `getDrmSummary()`, no truncation |
| F3-2: `## Historical Context` section injected after rubric in `buildSystemPrompt` | APPEARS MET | analyzer.ts:11-17: `historySec` appended immediately after `${rubric.rawText}` |
| F3-3: Section omitted entirely when no history exists | APPEARS MET | `historyContext ? \`\n${historyContext}\n\` : ''` — empty string omits section |
| F9-1: On analysis failure, write error record to weekly file | APPEARS MET | cli.ts:81-85 calls `upsertErrorInWeekly(today, entries.length, errorType, errorMessage)` in catch block |
| F9-2: Extend `WeekDayRecord` with optional `error?`, `errorType?`, `errorMessage?` | APPEARS MET | types.ts:60-63 |
| F9-3: `promptiq status` surfaces "N days failed to analyze" | APPEARS MET | renderer.ts:129-153 scans weekly files for `error === true` and prints `⚠ N day(s) failed to analyze: [dates]` |
| F11-1: Add `--file <path>` to `promptiq log` | APPEARS MET | cli.ts:33: `.option('--file <path>', 'Read prompt from file instead of stdin')` |
| F11-2: `runLog()` gains optional `filePath?: string` | APPEARS MET | logger.ts:132 |
| F11-3: File contents stored identically to stdin-sourced prompt | APPEARS MET | logger.ts:137-139: `fs.readFileSync(filePath, 'utf-8').trim()` — same path as stdin |
| F11-4: Hook contract preserved (stdin fallback present) | APPEARS MET | `else` branch at logger.ts:140-148 |
| All 22 existing tests pass | APPEARS MET | `npm test`: 33 passed, 0 failed |
| 11 new tests covering new behaviors | APPEARS MET | See test verification below |
| `buildHistoryContext` monthly path covered by test | APPEARS MET | drm.test.ts:154-178: monthly file seeded; `### Monthly summaries`, `2026-03`, `150 prompts`, `0.68` all asserted |
| Build exits 0 | APPEARS UNMET | `npm run build` fails due to `@rollup/rollup-linux-x64-gnu` missing native binary (WSL pre-existing issue, documented in CLAUDE.md) |

## Properties Not Verifiable Without Play Mode

Not applicable — this is a TypeScript CLI project. No runtime/play-mode distinction applies.

---

## Test Suite Verification

All 33 tests pass (22 original + 11 new), 0 failures, confirmed by `npm test`.

**New tests added and verified:**
| Test | File | Covers |
|---|---|---|
| `calls messages.create with tool_choice: report_analysis` | analyzer.test.ts | F4: tool_choice assertion |
| `throws if no tool_use block returned` | analyzer.test.ts | F4: error path |
| `passes historyContext to buildSystemPrompt (history section absent when no history)` | analyzer.test.ts | F3: history injection |
| `buildHistoryContext returns empty string when no files exist` | drm.test.ts | F3: empty case |
| `buildHistoryContext includes weekly entry when weekly file exists` (extended) | drm.test.ts | F3: weekly + monthly formatting |
| `upsertErrorInWeekly writes error record to weekly file` | drm.test.ts | F9: write |
| `upsertErrorInWeekly does NOT overwrite a successful analysis entry` | drm.test.ts | F9: guard |
| `renderStatus shows failed day count when error days present` | renderer.test.ts | F9: UI |
| `renderStatus does not show warning when no error days` | renderer.test.ts | F9: UI clean path |
| `runLog(filePath) reads prompt from file when path provided` | logger.test.ts | F11: file path |
| `runLog(filePath) throws when file does not exist` | logger.test.ts | F11: missing file |

Lint: `npm run lint` exits 0 (tsc --noEmit passes clean).

---

## Failures & Root Causes

### Build not updated (deferred)
**Category**: `INCOMPLETE_TASK`
**What happened**: `npm run build` fails in WSL due to `@rollup/rollup-linux-x64-gnu` missing native binary. This is a pre-existing limitation documented in CLAUDE.md. The fixer correctly deferred this — it is not a regression from this implementation.
**Why**: Environment constraint, not a code defect. CLAUDE.md explicitly states "the committed `dist/cli.js` is usable as-is."
**Evidence**: Working log: "Build: FAILED — pre-existing WSL `@rollup/rollup-linux-x64-gnu` issue (not caused by this implementation)."

---

## Verification Gaps

None. All spec goals are statically verifiable from source and test files in this TypeScript CLI project.

---

## Actionable Errors

### Error 1: `dist/cli.js` not updated
- **Category**: `INCOMPLETE_TASK`
- **File(s)**: `dist/cli.js`
- **What broke**: `dist/cli.js` does not include any of the four factor improvements. Users running `promptiq` via the binary will not have Tools API, DRM history injection, error records, or `--file` flag.
- **Evidence**: WSL build failure; `dist/cli.js` predates all changes.
- **Suggested fix**: Build on a non-WSL machine (or Windows-native Node) and commit the updated `dist/cli.js`. This is the only remaining unresolved issue.

**Not actionable (resolved by this fix pass or deferred by design):**
- Error 2 from prior audit (monthly path test gap): RESOLVED. drm.test.ts now seeds a monthly file and asserts `### Monthly summaries`, `2026-03`, `150 prompts`, and `0.68` in `buildHistoryContext` output.
- The `upsertErrorInWeekly` compressed-week silent-return behavior: design decision, not a bug.
- `historySec` blank-line cosmetics in `buildSystemPrompt`: functionally correct for the LLM.

## Rule Violations

None. All CLAUDE.md hard rules were observed:
- No new npm dependencies added
- Import extensions preserved as `.js`
- `__dirname` / CJS not changed
- Hook contract preserved (exits 0, no network calls in `runLog`)
- DRM invariant preserved (`upsertErrorInWeekly` does not delete daily file)

## Task Completeness
- **Unchecked items**: None (all verification items confirmed)
- **De-facto incomplete**: `npm run build` exits 0 — pre-existing WSL issue, deferred

---

## Proposed Skill Changes

No new proposed changes beyond those already listed in the prior audit (Retros/audit-impl--2026-04-12--23-30--12-factor-improvements.md). The only open proposal is:

### CLAUDE.md — Document build-before-commit requirement for WSL workarounds
**Insert after**: `## Gotchas` → rollup native binaries paragraph
```diff
+ **Build must be committed**: When `npm run build` is run on a non-WSL machine,
+ the updated `dist/cli.js` must be committed before merging a feature branch.
+ If the build cannot run in WSL, build on Windows or in a Linux VM, then copy
+ `dist/cli.js` into the worktree and commit it.
```
**Why**: Prevents future implementations from shipping source-only changes with a stale binary.
[ ] Apply?

---

## Proposed learnings.md Additions

```
- 2026-04-13 [12-factor-improvements]: Post-fix re-audit confirmed fixer correctly addressed the monthly-path test gap and correctly deferred the WSL build failure. Re-audit is lightweight when fixer changes are scoped. → audit-implementation.md (add note: re-audit only needs to verify fixer's stated changes + confirm no regressions)
```
