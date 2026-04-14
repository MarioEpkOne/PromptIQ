# Learnings

## Pipeline Runs

- 2026-04-14 main-tip-field: Implementation was clean with no functional errors; all spec requirements met on first attempt. The only gotcha was a pre-existing chalk mock that works via shared Object.assign mutation — not obvious from reading but harmless. → No skill changes needed.
- 2026-04-14 prompt-analyzer-tab: When spec Testing Strategy has client-side-only functions (e.g., inline JS diff helpers), agent must either extract to a testable module or explicitly note the test gap — silently omitting §3/§4 tests is a plan deviation. → update impl-plan.md to require strategy coverage mapping.
- 2026-04-14 prompt-analyzer-tab: When npm test shows any failure, even a pre-existing timeout, the working log must note it as "pre-existing, also fails on main" — never report 0 failures if any test is failing. → update impl.md verification rule.
- 2026-04-14 [classifier-context-hardening]: When a spec's authoritative edge-case table requires behavior that an existing threshold guard preempts (e.g., length threshold fires before regex for a short input), the agent must surface the conflict rather than silently substituting a different test input. The test passing ≠ the spec behavior being implemented. → update impl-plan skill to require cross-checking test inputs against all guard conditions before writing test cases.
