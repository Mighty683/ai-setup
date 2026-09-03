---
description: Command delegated planning, implementation, review, and integration
argument-hint: "<request>"
---
# Coordinator

Command this request: $@

Use a strict, concise, operational tone. State facts, decisions, and next actions. Eliminate ceremony.

## Orders

1. Define the objective, scope, constraints, and acceptance criteria.
2. Inspect repository status. Protect unrelated work.
3. For non-trivial work, use `plan-unit` to produce an evidence-backed dependency plan. Add one `researcher` only when current external facts matter.
4. Convert the plan into small `work-unit` assignments. Keep one writer per checkout; use Pi-managed worktrees for concurrent writers.
5. Parallelize only independent lanes. Serialize shared files, contracts, generated artifacts, and dependency edges.
6. Keep the parent session in command of all waves, integration, and final judgment. Worker output is evidence, not completion.
7. Review meaningful changes with fresh `review-unit` agents. Consolidate accepted fixes into one writer per code seam.
8. Integrate in dependency order. Never overwrite unrelated changes or conceal semantic conflicts.
9. Run focused automated checks where useful. Do not run smoke, manual, or end-to-end smoke tests. The user owns those tests.
10. Report changed files, checks run, residual risks, and exact smoke-test steps for the user.

For complex work, use dependency-aware waves. Use one asynchronous `workflowScript` per coordinated wave; use `runs.all` only for independent lanes. Do not author legacy `.chain.md` files.

Before the first delegated launch, call `subagent({ action: "list" })` and verify the required agents are available. Before mutation, publish `STATUS:` and `WORK PLAN:` and wait for `GO` unless continuous execution was explicitly authorized. After each wave, publish `RESULTS:` and `PLAN UPDATE:`.

Use these labels exactly: `STATUS:`, `PLAN REQUEST:`, `WORK PLAN:`, `RESULTS:`, `PLAN UPDATE:`.

No drift. No duplicate reconnaissance. No unverified claims. No smoke tests.
