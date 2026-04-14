# Bug Fix: Analyze button re-analyzed all today's prompts on every run

**Date:** 2026-04-15
**Symptom:** Clicking Analyze re-analyzed all of today's logged prompts every time, even entries already analyzed in a previous run.
**Root cause:** `server.ts:976` — `analyzeToday()` was always called with the full `todayEntries` array. `WeekDayRecord` had no `analyzedAt` timestamp, so there was no way to filter out already-analyzed entries.
**Confidence at diagnosis:** 95%
**Fix:** Added `analyzedAt?: string` to `WeekDayRecord` (types.ts). `upsertDayInWeekly()` now stamps `analyzedAt: new Date().toISOString()` when persisting a result (drm.ts:140). In `/api/run-analysis`, entries are filtered to only those with `timestamp > analyzedAt` before being passed to `analyzeToday()` (server.ts:966–970).
**Files changed:** `src/types.ts`, `src/drm.ts`, `src/server.ts`
**Tests:** Build exits 0. Existing test suite not re-run (no test for this specific flow existed).
