---
description: Coordinate research, an accepted plan, and delegated implementation
argument-hint: "<request>"
---

# Mission Coordination

Coordinate this request: $@

Use `research-unit` when investigation is needed and `plan-unit` to produce an implementation plan from the conversation and available research. Present the plan and wait for the user's acceptance before implementing it.

After acceptance, implement the plan and delegate independent assignments to `work-unit` or focused reviews to `review-unit` as useful. Research, planning, and work units may delegate their own subtasks. Collect results and resolve ordinary implementation issues within the accepted scope.

All agents use the same current checkout. Pass `worktree: false` and `isolation: "none"` when delegating; do not create worktrees. Keep one active writer per cwd, even for disjoint files. Parallelize only read-only work, hand off writing sequentially, and preserve unrelated changes.

Run focused validation, inspect delegated changes, and present the finished work for user acceptance or correction. The main agent owns the outcome.
