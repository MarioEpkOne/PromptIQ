# PromptIQ

**Prompt analytics for Claude Code.** PromptIQ silently captures every prompt you send, scores them against a customizable rubric using the Claude API, and builds a Decaying-Resolution Memory (DRM) of your prompting patterns over weeks and months — so you can consistently level up the way you communicate with AI. Comes with an Analyzer tab where you can paste any prompt and get instant per-criterion feedback, so you can test and refine prompts before you send them.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [How It Works](#how-it-works)
  - [Silent Logging](#silent-logging)
  - [Scoring & Analysis](#scoring--analysis)
  - [Decaying-Resolution Memory (DRM)](#decaying-resolution-memory-drm)
  - [Prompt Classification](#prompt-classification)
  - [Web Dashboard](#web-dashboard)
  - [Automation](#automation)
- [Rubric](#rubric)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [12-Factor Agent Principles](#12-factor-agent-principles)
- [Data Storage](#data-storage)
- [Development](#development)

---

## What It Does

PromptIQ is a developer tool that treats prompts as measurable engineering artifacts. It answers the question: *Am I getting better at prompting AI, and where am I consistently weak?*

- **Zero-friction capture** — a Claude Code hook logs every prompt as a single disk write, adding no latency to your workflow
- **Rubric-based scoring** — Claude evaluates each prompt on criteria you define (clarity, context, constraints, expected output, scope)
- **Pattern detection** — recurring weaknesses (e.g. "missing expected output format" appearing 3 weeks running) surface as persistent patterns
- **Actionable tips** — each analysis produces a single highest-leverage `mainTip` with a concrete before/after example
- **Long-term memory** — the DRM system compresses daily logs into weekly and monthly summaries, keeping storage O(1) over time
- **Web dashboard** — Status, Patterns, and Last Prompts tabs for browsing your history; an **Analyzer tab** for on-demand single-prompt scoring and rewriting
- **On-demand analysis** — trigger a full analysis from the dashboard without touching the terminal

---

## Quick Start

```bash
npm install -g promptiq
export ANTHROPIC_API_KEY=sk-ant-...
promptiq analyze   # score today's prompts
promptiq serve     # open the dashboard
```

Register the Claude Code hook in `~/.claude/settings.json` to start logging automatically — see [Configuration](#configuration). For scheduling and WSL setup, see [`promptiq schedule`](#commands).

---

## Commands

| Command | Description |
|---|---|
| `promptiq analyze` | Score today's prompts, update DRM, print analysis with main tip |
| `promptiq catchup` | Analyze any missed days (useful after the laptop was off) |
| `promptiq status` | Today's count, last analysis date, DRM summary |
| `promptiq patterns` | Weekly and monthly pattern trends in the terminal |
| `promptiq last [n]` | Show the last *n* logged prompts (default: 10) |
| `promptiq rubric` | Open your rubric in `$EDITOR` |
| `promptiq serve [--port N]` | Start the local web dashboard (default: port 4242) |
| `promptiq schedule [--time HH:MM]` | Install daily cron job + optional startup catch-up |
| `promptiq log` | Append the current prompt to today's JSONL (called by the hook) |

---

## How It Works

### Silent Logging

Every prompt you submit in Claude Code triggers the `UserPromptSubmit` hook, which calls `promptiq log`. This is a **pure disk write** — it appends one JSON line to `~/.promptiq/daily/YYYY-MM-DD.jsonl` and exits with code 0, unconditionally. No API call, no network, no blocking.

```jsonl
{"timestamp":"2026-04-14T15:30:00Z","prompt":"Refactor the login handler to..."}
{"timestamp":"2026-04-14T16:02:00Z","prompt":"ok"}
```

The hook never throws. If the data directory doesn't exist it's created silently. If the disk is full the error is swallowed. Your Claude Code session is never disrupted by PromptIQ.

### Scoring & Analysis

`promptiq analyze` loads today's JSONL, strips control prompts (see [Prompt Classification](#prompt-classification)), and calls the Claude API **once** with all remaining prompts in a single batch. Claude is given your rubric as the system prompt and returns a structured `report_analysis` tool call — never free-form text.

**Wire format**: when the analysis call is assembled, the rubric and each prompt are wrapped in XML tags (`<rubric criteria="N">` and `<prompt index="1">`). Claude is trained to parse XML-delimited content with high reliability — it cleanly separates instructions from data, reducing misinterpretation and making boundary errors essentially impossible. All content is XML-escaped via `escapeXml()` to prevent prompt injection from user-authored rubric files or multi-line prompts. The results that come back are stored on disk as JSON (see [Data Storage](#data-storage)) — the XML exists only inside the API call.

The tool call extracts:

| Field | Type | Description |
|---|---|---|
| `scores` | `Record<index, number>` | 0–1 composite score per prompt |
| `avgScore` | `number` | Weighted mean across all prompts |
| `patterns` | `Pattern[]` | Recurring issues with frequency counts |
| `suggestions` | `Suggestion[]` | Up to 3 improvements with before/after examples |
| `mainTip` | `{ text, why }` | Single highest-leverage improvement |
| `summary` | `string` | Prose digest stored in DRM for long-term recall |

Results are written atomically to the weekly DRM file before any cleanup runs.

### Decaying-Resolution Memory (DRM)

The DRM is a three-tier compression system that keeps storage bounded while preserving trend information indefinitely.

```
Daily JSONL  →  (7+ days old)  →  Weekly JSON  →  (4+ weeks old)  →  Monthly JSON
 Full prompts                    Per-day summaries                  Aggregated stats
 ~50 KB/day                      ~5 KB/week                         ~1 KB/month
```

**Rollup rules:**

1. Daily files older than 7 days are compressed into their weekly record and deleted
2. Within a weekly file, days older than the current week are demoted from `"detail": "daily"` to `"detail": "compressed"` (per-prompt text is dropped, summaries kept)
3. Weekly records older than 4 weeks are rolled into a monthly aggregate and removed

**Persistent patterns** track how many distinct weeks a pattern appeared in, so a pattern that shows up every week for a month ranks higher than one seen once.

The DRM rollup runs automatically at the end of every `analyze` call. No manual maintenance required.

### Prompt Classification

Before scoring, prompts are classified as **task prompts** or **control prompts**. Control prompts — one-word confirmations, emoji responses, yes/no replies — are excluded from scoring because they carry no signal about prompting quality.

Built-in control patterns:
```
yes | no | ok | proceed | lgtm | 👍 | continue | done | sure | yep | nope
```

You can extend this list in `~/.promptiq/classifier.json`:

```json
{
  "additionalPatterns": ["^approved$", "^ship it$", "^merge$"],
  "excludeDefaults": false
}
```

Set `excludeDefaults: true` to disable all built-in patterns and use only the patterns you supply.

The minimum length threshold (default: 11 characters) provides a final safety net.

### Web Dashboard

`promptiq serve` starts a local HTTP server with an embedded single-page dashboard (no build step, no external dependencies).

**Tabs:**

- **Status** — today's prompt count, prompts captured since last analysis, last analysis timestamp, failed days, DRM tier stats, and a one-click **Analyze** button for on-demand analysis with a live loading spinner
- **Patterns** — clickable day/week/month cards with full analysis detail panels (per-criterion scores, patterns, suggestions, rewritten prompt)
- **Analyzer** — paste any prompt and run a single-prompt spot analysis; returns per-criterion scores, patterns, improvement suggestions, and a rewritten version
- **Last Prompts** — the 10 most recently logged prompts

**API endpoints** (consumable by any HTTP client):

```
GET /api/status          → today count, DRM summary
GET /api/patterns        → day/week/month list for display
GET /api/last            → last 10 raw prompts
GET /api/detail?type=day|week|month&id=<id>  → full analysis detail
```

### Automation

`promptiq schedule` installs two crontab entries:

```cron
0 23 * * *  ANTHROPIC_API_KEY=sk-ant-... /usr/bin/promptiq analyze
@reboot     ANTHROPIC_API_KEY=sk-ant-... /usr/bin/promptiq catchup && promptiq serve
```

The API key is embedded directly in crontab so the job works in non-login shells without sourcing `.bashrc`. The `catchup` command on reboot handles any days that were missed while the machine was off.

---

## Rubric

Your rubric lives at `~/.promptiq/rubric.md`. It is passed verbatim as the system prompt for every analysis run. Edit it freely — changes take effect immediately on the next `analyze` call.

**Default criteria:**

| Criterion | Weight | What it measures |
|---|---|---|
| Clarity | 1.0 | Is the intent unambiguous? |
| Context | 1.0 | Does the prompt include enough background? |
| Output Format | 0.8 | Does the prompt specify the response format or structure? |
| Scope | 0.8 | Is the prompt focused — not too broad or over-specified? |
| Examples | 0.5 | Where helpful, does the prompt include examples? |

To edit:

```bash
promptiq rubric   # opens in $EDITOR
```

---

## Configuration

| File | Purpose |
|---|---|
| `~/.promptiq/rubric.md` | Scoring criteria and weights |
| `~/.promptiq/classifier.json` | Additional control-prompt regex patterns |
| `~/.claude/settings.json` | Claude Code hook registration |

**Environment variables:**

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for analysis calls |
| `PROMPTIQ_HOME` | No | Override `~/.promptiq` data directory (used in tests) |
| `PROMPTIQ_PORT` | No | Default port for `serve` (default: 4242) |

---

## Architecture

```
src/
├── cli.ts          Entry point; commander command registration
├── logger.ts       JSONL append; path helpers; silent error handling
├── analyzer.ts     Claude API batch scoring; tool-use extraction; synthesis
├── drm.ts          DRM rollup logic; weekly/monthly compression; ISO week math
├── classifier.ts   Control-prompt detection; regex matching
├── rubric.ts       rubric.md loading; embedded fallback defaults
├── renderer.ts     Terminal output; chalk formatting; badge rendering
├── server.ts       HTTP server; embedded dashboard HTML/CSS/JS; REST API
└── types.ts        Shared TypeScript interfaces (LogEntry, DayAnalysis, etc.)

~/.promptiq/
├── daily/          YYYY-MM-DD.jsonl    (raw prompt log)
├── weekly/         YYYY-WNN.json       (compressed weekly records)
├── monthly/        YYYY-MM.json        (aggregated monthly summaries)
├── rubric.md                           (user-editable scoring criteria)
└── classifier.json                     (custom control-prompt patterns)
```

**Data flow:**

```
Claude Code session
      │
      ▼  (UserPromptSubmit hook — zero latency, no network)
promptiq log  ──→  ~/.promptiq/daily/YYYY-MM-DD.jsonl
                          │
                          ▼  (on-demand or cron)
promptiq analyze  ──→  classifier  ──→  Claude API (single batch call)
                                              │
                                        report_analysis tool
                                              │
                          ┌───────────────────┘
                          ▼
               weekly/YYYY-WNN.json  ──→  DRM rollup  ──→  monthly/YYYY-MM.json
```

---

## 12-Factor Agent Principles

PromptIQ is built around the [12-factor agents](https://github.com/humanlayer/12-factor-agents) principles for production-quality LLM applications. Each factor is described below with the specific design decision that satisfies it.

---

### Factor 1 — Natural Language to Tool Calls

> *The agent converts user intent into structured function calls, not free-form text.*

The `analyzeToday()` function calls the Claude API with a single tool definition — `report_analysis` — and requires Claude to respond exclusively through that tool. There is no text parsing, no regex extraction, no "best effort" JSON parsing from prose output. If Claude does not call the tool, the call is treated as an error.

```typescript
// analyzer.ts
const tool: Tool = {
  name: "report_analysis",
  input_schema: {
    type: "object",
    required: ["scores", "avgScore", "patterns", "suggestions", "mainTip", "summary"],
    properties: { /* strict JSON schema */ }
  }
};
```

This guarantees that every downstream consumer — the DRM writer, the renderer, the web API — receives a typed, validated object. No hallucinated fields, no missing keys.

---

### Factor 2 — Own Your Prompts

> *The application fully controls its prompts. No black-box prompt templating from a framework.*

The system prompt is assembled from three explicit, user-visible sources:

1. The rubric file (`~/.promptiq/rubric.md`) — user-editable, version-controllable
2. A small static instruction block in `analyzer.ts` — readable in source
3. The batch of prompts to score — derived directly from JSONL

There is no hidden prompt injection, no framework-managed template engine, no "magic" instructions added behind the scenes. A developer can `cat ~/.promptiq/rubric.md` and read the exact system prompt that Claude receives.

---

### Factor 3 — Own Your Context Window

> *The application deliberately constructs what the LLM sees. Context is shaped, not dumped.*

Three mechanisms keep the context window lean:

**Classifier filtering.** Control prompts (yes/no/ok/👍) are stripped before the batch reaches the API. Sending "ok" to Claude for scoring would waste tokens and dilute the analysis.

**DRM compression.** The `synthesizeWeek()` function receives compressed weekly summaries — prose digests — rather than raw JSONL files from past weeks. Historical context is pre-digested, not re-sent in full.

**Separation of concerns.** Daily analysis (`analyzeToday()`) and weekly synthesis (`synthesizeWeek()`) are separate API calls with separate context budgets. Each call receives only what is relevant to its task.

---

### Factor 4 — Tools Are Structured Outputs

> *Tool calls are the mechanism for validated, typed output — not a side-channel for actions.*

The `report_analysis` tool is the **only** output path from the analysis call. Its JSON schema enforces:

- `scores` is a record of numeric values (0–1)
- `patterns` is an array of objects with `name`, `description`, `frequency`
- `suggestions` each have `title`, `description`, `before`, `after` examples
- `mainTip` has both `text` and `why` fields

TypeScript interfaces in `types.ts` mirror the schema exactly. If the tool call response does not match the schema, the error surfaces at the boundary — not silently deep in rendering logic.

---

### Factor 5 — Unify Execution and Business State

> *Agent state and application data stay in sync. No divergence between what the agent did and what the system recorded.*

Every write follows a strict order:

1. The weekly JSON file is **written** with the new day's analysis
2. Only after a successful write is the DRM rollup triggered
3. Daily JSONL files are **deleted only after** their weekly record is confirmed on disk

There is no in-memory cache that can diverge from disk. If `promptiq analyze` crashes midway, the next run re-reads the weekly file (which may be partial) and the daily JSONL (which still exists) and recovers correctly. The rollup is idempotent.

---

### Factor 6 — Launch / Pause / Resume

> *Agent execution supports simple lifecycle control: start, stop, and resume.*

**Launch**: `promptiq analyze` — runs the full pipeline synchronously, exits when complete.

**Pause / Resume via `catchup`**: If the machine was off for three days, `promptiq catchup` iterates missed dates, runs analysis for each (skipping days with fewer than 3 task prompts), and applies the DRM rollup. The resume is safe to run multiple times — days already analyzed are skipped.

**Scheduled lifecycle**: `promptiq schedule` installs cron jobs that manage the daily launch automatically, including an `@reboot` job that resumes catch-up on machine restart.

---

### Factor 7 — Contact Humans with Tools

> *The agent surfaces decisions for human action through structured output, not buried in prose.*

The `mainTip` field is the primary human-in-the-loop touchpoint. It is always:

- A **single** improvement (not a list the human must prioritize)
- Accompanied by a `why` field explaining the reasoning
- Shown prominently at the top of `promptiq analyze` output and in the web dashboard

The design deliberately does not auto-apply suggestions or modify prompting behavior. Every insight surfaces as an observation for the human to act on. The agent analyzes; the human decides.

---

### Factor 8 — Own Your Control Flow

> *Decision logic lives in deterministic application code, not inside the LLM.*

The entire pipeline orchestration is TypeScript:

```
load JSONL  →  classify  →  batch API call  →  write DRM  →  rollup  →  render
```

Claude is invoked at exactly one point — the scoring step. It does not decide whether to run the rollup, which files to read, whether to skip a day, or how to format terminal output. Those decisions are encoded in the application.

The rollup logic (`drm.ts`) is pure TypeScript: date arithmetic, file I/O, object merging. It has no LLM dependency and is independently testable.

---

### Factor 9 — Compact Errors

> *Errors are concise, informative, and fit within the context window.*

**Hook errors are swallowed.** `promptiq log` always exits 0. A logging failure must never interrupt a Claude Code session.

**Analysis errors are localized.** If the weekly synthesis fails (network error, API timeout), `analyzeToday()` falls back to concatenating per-day summaries. The user gets a slightly less polished weekly view, not a crash.

**CLI errors print one line.** No stack traces to stdout in production mode. Errors surface as `promptiq: <message>` and exit 1.

**DRM errors are non-fatal.** If the rollup fails (e.g. corrupted JSON), the error is logged and the command exits successfully — today's analysis is already written; the rollup can be retried.

---

### Factor 10 — Small, Focused Agents

> *Each agent does one thing. No monolithic "do everything" LLM calls.*

PromptIQ uses **two distinct agent calls**, each with a narrow responsibility:

| Call | Function | Input | Output |
|---|---|---|---|
| **Daily analysis** | `analyzeToday()` | Today's prompts + rubric | Scores, patterns, suggestions, mainTip |
| **Weekly synthesis** | `synthesizeWeek()` | 7 day-summaries | Aggregated weekly narrative + persistent patterns |

Neither call knows about the other. The daily call does not reason about historical trends; the weekly synthesis does not see raw prompts. Each receives only the context it needs.

This separation keeps individual calls fast (< 2s each), cheap (small context), and independently debuggable.

---

### Factor 11 — Trigger from Anywhere

> *The agent can be invoked from multiple surfaces without re-architecting.*

PromptIQ supports four trigger surfaces:

| Surface | How | Use case |
|---|---|---|
| **CLI** | `promptiq analyze` | On-demand, interactive use |
| **Claude Code hook** | `UserPromptSubmit` → `promptiq log` | Automatic per-prompt logging |
| **Cron** | `promptiq schedule` | Daily automated analysis |
| **Reboot** | `@reboot` crontab entry | Startup catch-up + serve |

Each surface hits the same underlying functions. There is no "CLI mode" vs "hook mode" — the same `logger.ts` and `analyzer.ts` are called regardless of trigger surface.

---

### Factor 12 — Stateless Reducer Pattern

> *Given the same inputs, the agent produces the same outputs. No hidden state.*

`analyzeToday(date)` is a pure function of:
- The JSONL file for that date
- The rubric file
- The classifier config

Given identical inputs, it produces identical output. There is no session state, no global mutable cache, no dependency on prior runs. This makes it safe to re-run analysis for any date (the weekly record is overwritten with the same result) and makes testing straightforward — feed in a JSONL fixture and assert on the tool-call output.

The DRM rollup is similarly deterministic: given the same set of weekly files, it produces the same monthly aggregates.

---

## Data Storage

All data is local to `~/.promptiq/`. No cloud sync, no telemetry, no external database. Everything on disk is JSON or JSONL — the XML format is only used internally when constructing LLM requests (see [Scoring & Analysis](#scoring--analysis)).

**Daily log** (`~/.promptiq/daily/YYYY-MM-DD.jsonl`) — one JSON line per prompt:
```jsonl
{"timestamp":"2026-04-14T15:30:00Z","prompt":"Refactor the login handler..."}
{"timestamp":"2026-04-14T16:02:00Z","prompt":"ok"}
```

**Weekly analysis record** (`~/.promptiq/weekly/YYYY-WNN.json`) — JSON, one file per ISO week:
```json
{
  "week": "2026-W15",
  "startDate": "2026-04-13",
  "endDate": "2026-04-19",
  "detail": "daily",
  "days": {
    "2026-04-14": {
      "promptCount": 12,
      "avgScore": 0.78,
      "topPatterns": ["unclear-scope", "missing-context"],
      "mainTip": { "text": "...", "why": "..." },
      "summary": "Prompts were clearer than last week..."
    }
  }
}
```

**Monthly summary** (`~/.promptiq/monthly/YYYY-MM.json`) — JSON, compressed from weekly records:
```json
{
  "month": "2026-04",
  "weekCount": 4,
  "promptCount": 120,
  "avgScore": 0.75,
  "persistentPatterns": ["unclear-scope"],
  "patternFrequency": { "unclear-scope": 3, "missing-context": 2 },
  "summary": "April showed consistent improvement in clarity..."
}
```

**Storage growth** is O(1) asymptotically: daily files are compressed into weekly records after 7 days, and weekly records are compressed into monthly aggregates after 4 weeks. One year of prompting costs roughly 12 × ~1 KB = ~12 KB of monthly summaries, plus the current month's weekly files.

---

## Development

```bash
# Install dependencies
npm install

# Build (outputs to dist/)
npm run build

# Watch mode
npm run dev

# Type check
npm run lint

# Tests
npm test

# Install locally for testing
npm install -g .
```

**Tech stack**: TypeScript 5.4+, Node.js 18+, `tsup` (build), `commander` (CLI), `@anthropic-ai/sdk`, `chalk`, `jest` (tests).

**Testing**: Unit tests cover the DRM rollup logic, classifier patterns, rubric parsing, and analyzer output shape using fixture JSONL files. Integration tests call the real Claude API (requires `ANTHROPIC_API_KEY` in env).

---

## License

MIT
