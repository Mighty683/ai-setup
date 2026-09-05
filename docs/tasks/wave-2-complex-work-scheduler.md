# Complex-work Scheduler Automation

## Description

Move research, plan compilation, dependency scheduling, and phase advancement into the complex-work extension so the root model handles only ambiguity and explicit user gates. Maximize safe parallel execution without exposing workflow paths to agents.

## Research summary

Pi-subagents exposes async `spawn` and completion events through its public in-process RPC. Workflow scripts can use `runs.all` for bounded fanout and registered agent names for role selection. Ordinary Markdown can remain the planner contract when it ends in a fenced JSON interchange record that the extension validates and repairs independently.

The existing executor parallelized only lanes inside the first ready wave. Independent ready waves can also be batched when their scoped files and claimed contracts do not conflict. Integration, review, verification, and closure can treat such a batch as one runnable boundary while preserving the original wave IDs.

## Status

finished

## Acceptance criteria

- `/complex-work` launches parallel research and synthesis without a root-agent orchestration turn.
- Research and planning use ordinary Markdown with deterministic validated records and bounded automatic repair.
- Only unresolved authority decisions, GO, blockers, and verification wake the root agent.
- All dependency-ready, conflict-free lanes are dispatched concurrently within a bounded cap and isolated worktrees.
- Integration and review advance automatically, and batch closure records every source wave.
- RPC failures and semantic blockers remain retryable; duplicate completion events are idempotent.
- Focused extension, contract, and workflow tests pass with no blocking diagnostics.

## Runnable-state evidence

`npm test --force` passes all 30 contract, extension, and workflow tests. Primary TypeScript diagnostics report no errors for the controller and contract compiler. `git diff --check` passes. The npm `--force` flag bypasses only the repository's package-manager engine mismatch (`pnpm` is preferred); the test command itself exits successfully.

## Blockers

None.
