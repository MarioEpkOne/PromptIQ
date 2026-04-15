# Spec: Documentation Accuracy Audit Workflow

**Scope**: Define a repeatable, efficient workflow for README/documentation accuracy audits as a Claude Code skill. Based on a post-session audit that identified five structural inefficiencies in the current ad-hoc approach.

---

## Problem

When an agent audits a README against source code, the current unguided approach produces:

- **Multiple read rounds** — files are read across 2–3 LLM turns instead of one, because the agent discovers needed files as it goes rather than planning upfront
- **Partial file reads** — the agent reads the first N lines of large files, creating silent gaps where README claims cannot be verified
- **Sequential edits** — each fix is dispatched as a separate Edit call, each requiring its own LLM inference turn
- **No grep verification** — the final check is a `git diff`, which confirms what changed but cannot catch what was missed

The result is a session with an estimated 3× more LLM turns than needed and a verification gap that only gets caught by luck.

---

## Decision: New `doc-audit` Skill

Create a Claude Code skill at `~/.claude/skills/doc-audit.md` that enforces the optimized workflow. The skill activates when the user asks to audit or fix documentation against the actual implementation.

**Why a skill, not a CLAUDE.md instruction?**

A skill encapsulates a specific workflow pattern without polluting the global CLAUDE.md with procedure that only applies to one task type. It is invocable explicitly (`/doc-audit`) and composable with other skills.

---

## Workflow Requirements

### R1 — Plan the read set before issuing any reads

Before opening any file, the agent must:

1. Read CLAUDE.md (or equivalent architecture notes) to get the full file list
2. Identify every source file that the doc references by name, type, or behavior
3. Issue all reads in a **single parallel batch**

No file should be read in a later turn that could have been identified in the planning step.

### R2 — Read files fully when the task is cross-file verification

For documentation accuracy audits, files must be read in full. Partial reads (e.g. first 80 lines) are only acceptable when the agent has confirmed that the README claim being verified maps to code in that range. When uncertain, read the full file.

### R3 — Enumerate all discrepancies before editing anything

After reads complete, the agent must produce an internal list of all discrepancies before issuing any Edit call. Format:

```
[N discrepancies found]
1. File:line — what README says vs. what code does
2. ...
```

No edit may be dispatched until this list is complete. This prevents the agent from fixing the first three bugs it sees while missing a fourth.

### R4 — Dispatch edits in parallel when they touch non-overlapping regions

Edits to different sections of the same file that do not share line ranges are independent and may be dispatched in parallel. The agent must batch them into a single message where possible.

If the number of edits is ≥ 4 and they are scattered across the file, prefer a single `Write` call with the fully corrected file over multiple `Edit` calls.

### R5 — Grep verification pass before committing

Before `git add`, the agent must run a targeted grep pass to verify no documented claim was missed. At minimum:

- For every port number or default value mentioned in the README: grep the source for that literal value
- For every flag, command name, or config key shown in the README: grep the source for that identifier
- For every function name cited in prose: grep the source to confirm it exists

Any grep that returns zero results for a value the README claims exists is a blocker.

---

## Skill File Content

The skill file defines the ordered procedure the agent must follow:

```markdown
# doc-audit skill

## Activation
Use when asked to: audit README against implementation, fix documentation inaccuracies,
verify that docs match code, or check that a changelog/spec is accurate.

## Procedure

### Step 1 — Read architecture notes (1 tool call)
Read CLAUDE.md or equivalent project notes to identify the full source file list
and any architecture invariants the docs may describe.

### Step 2 — Plan the read set (0 tool calls — pure reasoning)
List every source file the documentation references. Include files referenced
implicitly (e.g. "the weekly file format" → drm.ts + types.ts).

### Step 3 — Read all files in one parallel batch
Issue all reads in a single message. Read files fully (no line limits) unless
the file is >400 lines and the relevant claims are clearly localized.

### Step 4 — Enumerate all discrepancies
Produce a numbered list of every mismatch between docs and code before touching
any file. Do not edit until the list is complete.

### Step 5 — Grep verification (parallel)
For each documented default value, flag, key name, and function name:
grep the source. Zero hits = blocker to resolve before editing.

### Step 6 — Dispatch all edits
If ≥ 4 non-overlapping edits: use a single Write call with the corrected file.
If < 4 edits: batch parallel Edit calls in one message.

### Step 7 — Verify with git diff
Review the full diff. Confirm the discrepancy list from Step 4 is exhausted.

### Step 8 — Commit and push
Commit with a message that lists the specific claims fixed (not "fix README").
```

---

## File to Create

```
~/.claude/skills/doc-audit.md
```

Content: the skill file defined above.

No source code changes. No build step. The skill is usable immediately after the file is written.

---

## Verification

After creating the skill:

1. Run `/doc-audit` on this project's README — agent must issue all source reads in a single parallel batch (Step 3)
2. Confirm agent produces a numbered discrepancy list before issuing any Edit call (Step 4)
3. Confirm agent runs at least one grep for a documented default value before committing (Step 5)
4. Confirm commit message lists specific claims fixed (Step 8)

---

## Out of Scope

- Automating the audit on a schedule (not useful — docs drift slowly)
- Linting the README for broken links (separate concern)
- Applying this workflow to non-documentation files (types.ts, schemas, etc.) — the verification step would need to be adapted
