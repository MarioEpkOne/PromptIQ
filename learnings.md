# Learnings

## Worktree Lifecycle

- 2026-04-15 [general]: Worktrees accumulate on disk because the workflow (impl.md, pipeline.md) has no cleanup step after merging to master. The pipeline creates a worktree, does the work, merges the branch, then stops — there is no instruction to call ExitWorktree or delete the branch. Result: merged branches and their directories pile up indefinitely. Fix: after every successful merge to master, explicitly remove the worktree (`ExitWorktree action=remove`) and delete the branch (`git branch -d <worktree-branch>`). Check for stale ones with `git branch --merged master | grep worktree`.

## Spec Writing

- 2026-04-15 readme-blocker-fixes: When fixing factual errors in a README table, also grep for prose descriptions of the same facts elsewhere in the file — stale duplicates are easy to miss when spec scope is table-only. → spec writing habit (not a skill rule)

## Server / Process

- 2026-04-15 [prompt-analyzer-tab]: After a pipeline merges a worktree and rebuilds, the new server starts on the default port (4242) but the old server on `PROMPTIQ_PORT=80` (port 80) is **not automatically killed**. The user's browser hits port 80 → stale process → missing features. Fix: after any pipeline-triggered server restart, explicitly kill the old process first (`kill <pid>`), then relaunch with `PROMPTIQ_PORT=80`. Symptom: new tab is in `dist/cli.js` but not visible in the web app.

- 2026-04-15 [prompt-analyzer-tab]: When a pipeline asks "commit changes to master?" and the user confirms, the fast-forward merge **does succeed** — commits land directly in master's linear history without a merge commit. Don't confuse "no merge commit" with "merge didn't happen." Verify with `git branch --contains <sha>` rather than looking for a Merge commit in the log.

