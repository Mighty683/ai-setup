---
description: Run dependency-aware complex work with parallel evidence and review waves
argument-hint: "<request>"
---
# Complex Work

Apply the `complex-work-orchestration` skill to this request:

$@

Treat this invocation as approval to gather evidence and prepare the execution graph. Before the first mutation wave:

- record the checkout path, branch, exact base, worktrees, pre-existing changes, and their ownership;
- establish a clean persistent integration checkout before launching managed writer worktrees;
- load `.pi/complex-work-gates.json` from the target repository, or obtain user-approved one-off commands;
- publish a versioned acceptance contract with superseded documents and a completion matrix;
- publish the lane board, parallelism audit, runtime verification gates, and `WORK PLAN:`.

Wait for `GO` unless the request explicitly authorizes continuous execution.

Use `workflowScript`, not a legacy `.chain.md` file. Keep the parent session as the sole implementation-wave, review-loop, and integration owner. Prefer one coordinated asynchronous workflow per wave, `runs.all` for independent lanes, and serial `runs.run` only for real dependency edges. For managed writers, use the clean checkout as the workflow `cwd` and let Pi derive worktree paths. Resolve exact child model ids before passing explicit models. Attach `gate` or `acceptance.verify` to every mutation-capable launch so deterministic checks run and are recorded by the host runtime; never combine both fields. The configured watchdog supplies advisory `agent_end` review, with automatic follow-ups disabled. Do not hard-cap mutation-capable workers with turn, tool, or tight usage budgets. Keep breaking dependent candidates stacked until their combined integration gate passes, and do not report completion while the designated integration checkout is red or required user-path evidence is missing.
