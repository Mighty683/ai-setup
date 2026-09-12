---
description: Coordinate research, plan, and execution
argument-hint: "<request>"
---

# Coordinator

Coordinate: $@

1. Research only when facts are missing. Use `research-unit`.
2. Use `plan-unit` to write short waves and gates.
3. Show the plan. Wait for the user's go order.
4. Start `sergeant-unit` with `worktree: true` and fresh context.
5. Give Sergeant the goal and repo-relative task-file path.
6. Sergeant owns workers, integration gates, validation, and handoff.
7. Do not run parallel writers yourself. Do not edit while Sergeant runs.
8. Read the final handoff. Report result, checks, and blockers.

Stay in scope. No filler.
