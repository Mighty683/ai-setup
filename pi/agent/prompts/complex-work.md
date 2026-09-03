---
description: Run dependency-aware complex work with parallel evidence and review waves
argument-hint: "<request>"
---
# Complex Work

Apply the `complex-work-orchestration` skill to this request:

$@

Treat this invocation as approval to gather evidence and prepare the execution graph. Before the first mutation wave, publish the acceptance contract, lane board, parallelism audit, and `WORK PLAN:`. Wait for `GO` unless the request explicitly authorizes continuous execution.

Use `workflowScript`, not a legacy `.chain.md` file. Keep the parent session as the sole implementation-wave, review-loop, and integration owner. Prefer one coordinated asynchronous workflow per wave, `runs.all` for independent lanes, and serial `runs.run` only for real dependency edges.
