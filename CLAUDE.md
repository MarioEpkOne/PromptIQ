# PromptIQ — Project Notes for Claude

## Repository

- **Remote**: `git@github.com:MarioEpkOne/PromptIQ.git`
- **GitHub**: https://github.com/MarioEpkOne/PromptIQ
- **Main branch**: `master`

Prompt analytics CLI for Claude Code. Logs every user prompt via a hook, analyzes them on demand with the Anthropic API, and maintains a Decaying-Resolution Memory (DRM) over time.

## Architecture

Single Node/TypeScript CLI compiled by `tsup` to `dist/cli.js` (CommonJS). Entry point: `src/cli.ts` (commander).

| File | Responsibility |
|---|---|
| `src/cli.ts` | Commander setup, command wiring, env checks |
| `src/logger.ts` | `~/.promptiq/` layout, JSONL append, daily reads, `runLog()` (hook entry) |
| `src/rubric.ts` | Load/parse `rubric.md` (H3 `### Name (weight: N.N)`), fallback to embedded default |
| `src/analyzer.ts` | Anthropic API call, JSON parse with one retry, `DayAnalysis` result |
| `src/drm.ts` | ISO-week math, daily→weekly→monthly rollup, compression, file I/O |
| `src/renderer.ts` | Chalk-based terminal output for analyze/status/patterns/last |
| `src/classifier.ts` | Control-prompt detection; filters hook/slash commands from analysis |
| `src/server.ts` | HTTP dashboard server; inline HTML (no static files); JSON API endpoints |
| `src/types.ts` | All shared type definitions (no runtime code) |

## Storage layout

```
~/.promptiq/
├── rubric.md                  # user-editable scoring rubric
├── daily/YYYY-MM-DD.jsonl     # one prompt per line: {timestamp, prompt}
├── weekly/YYYY-Www.json       # WeeklyRecordDaily | WeeklyRecordCompressed
└── monthly/YYYY-MM.json       # MonthlyRecord
```

Override root with `PROMPTIQ_HOME` env var (used by tests — points to a tmp dir, the `.promptiq` subdir is still appended).

## DRM invariants

- **Never delete a daily file before its weekly record is written.** `runRollup()` in `src/drm.ts` writes the weekly file first, then calls `deleteDailyFile()`.
- **Today's file is never rolled up** — the rollup explicitly skips `date >= today`.
- **Rollup thresholds**: daily→weekly after 7 days; weekly detail decays to `compressed` for all weeks older than the most recent complete ISO week; weekly→monthly after 28 days.
- **Re-analyzing a day** overwrites its entry in the weekly file (`upsertDayInWeekly`). If the week was already compressed, it's replaced with a fresh `daily`-detail record containing only the re-analyzed day.
- ISO weeks use Monday–Sunday; all date math is UTC at noon (`T12:00:00Z`) to dodge DST/TZ edges.

## Web dashboard

`promptiq serve` starts a Node `http.Server` on port 80 (override with `PROMPTIQ_PORT` or `--port`). The entire UI is a single template literal string (`DASHBOARD_HTML`) embedded in `src/server.ts` — **no static files, no bundler, no external assets at runtime** (fonts load from Google Fonts). JSON API routes: `/api/status`, `/api/patterns`, `/api/last`, `/api/detail?type=&id=`. The server is read-only — it never writes to storage. After any change to `src/server.ts`, rebuild and restart: `npm run build && kill $(pgrep -f "cli.js serve") && promptiq serve`.

## Hook contract (critical)

`promptiq log` is called from Claude Code's `UserPromptSubmit` hook. Requirements:
- Reads prompt from stdin, appends one JSON line, exits.
- **No API calls**, no network, no heavy work — the hook is on the user's prompt hot path.
- **Must never block or fail Claude Code.** Any error is caught in `cli.ts`, written to stderr, and the process exits 0.

## Analyzer contract

- Requires `ANTHROPIC_API_KEY`. Checked in `cli.ts` before calling `analyzeToday`.
- Current model: `claude-sonnet-4-6` (update in `src/analyzer.ts` if needed — options include `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`).
- Expects strict JSON back; strips markdown fences; retries once with a stricter instruction; throws on second failure.
- On any analyzer failure, the daily file is preserved so the user can retry.
- Minimum 3 prompts/day required to analyze (`cli.ts:64`).

## Rubric format

Parser in `src/rubric.ts:parseRubric` splits on `^### ` and expects the first line of each section to match `Name (weight: N.N)`. Description is the rest of the section. Sections without a weight line are silently skipped.

## CLI Commands

| Command | What it does |
|---|---|
| `promptiq log` | Append one prompt from stdin (hook entry — no API calls) |
| `promptiq analyze` | Analyze today's prompts with the Anthropic API; write to weekly file |
| `promptiq catchup` | Analyze all unanalyzed past days in sequence |
| `promptiq status` | Show today's count, last analysis date, weekly/monthly summary counts |
| `promptiq patterns` | Show analyzed days/weeks/months with scores and top patterns |
| `promptiq last [n]` | Show the last N prompts logged today (default 10) |
| `promptiq rubric` | Print the current rubric in use |
| `promptiq serve` | Start local web dashboard at `http://promptiq` (port 80 by default) |
| `promptiq schedule` | Add/manage cron jobs for daily analysis and on-startup catch-up+serve |

## Build Commands

- `npm run build` — tsup → `dist/cli.js`
- `npm run dev` — watch mode
- `npm test` — jest (integration test uses `PROMPTIQ_HOME` tmp dir)
- `npm run lint` — `tsc --noEmit`

## Gotchas

- TS source uses ESM-style `.js` imports (`from './logger.js'`) but the build target is CJS. `tsconfig` + jest's `moduleNameMapper` handle this — don't change import extensions.
- `__dirname` is used in `cli.ts` to resolve `assets/` relative to `dist/`. Works because the output is CJS. If switching to ESM, this breaks.
- `rollup` native binaries can fail to install on WSL (`@rollup/rollup-linux-x64-gnu`). If `npm run build` errors, reinstall deps; the committed `dist/cli.js` is usable as-is.
- Tests warn to stderr (missing rubric, malformed JSONL lines) by design — not failures.
- **After any merge into master: always run `npm run build` in the main repo root.** The impl agent builds inside the worktree; merging source files does NOT update `dist/cli.js` in the main repo. The server (`promptiq serve`) runs from `dist/cli.js` — it will serve stale UI until rebuilt. After rebuilding, restart the server: `kill $(pgrep -f "cli.js serve") && promptiq serve`.
