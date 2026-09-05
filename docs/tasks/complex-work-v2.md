# Complex-work task graph rework

## Description

Replace the wave-script controller with a deterministic task scheduler, bounded autonomous roles, revision-bound user approval, private integration checkpoints, and recorded validation evidence.

## Research summary

The installed pi-subagents runtime supports public async RPC, runtime agent registration, strict tool allowlists, child extension bindings, terminal status snapshots, and child run IDs. Its managed worktrees require a clean source checkout. The implementation therefore uses private Git repositories and directly delegates leaf roles, preserving the original working tree and index until approved delivery.

## Status

finished

## Acceptance criteria

- Dependency-ready tasks refill available slots without wave barriers.
- Scouts, writers and reviewers have distinct enforced tools; no nested LLM coordinator.
- User commands approve exact revisions, pause/resume, steer, retry, replan, and cancel.
- Default plan/final checkpoints allow routine checks and bounded review corrections to continue.
- Duplicate/late events, uncertain RPC launches, missed completions, and command evidence support safe recovery.
- Changes and real check outcomes are inspected before integration and delivery.
- Existing staged, unstaged, untracked, and unrelated user work is preserved.

## Validation

All 30 tests passed using `node --test --test-isolation=none pi/agent/tests/*.test.mjs`. Coverage includes controller event paths, actual Git integration, durable command workers, cancellation/timeout, and runtime role registration. Strict TypeScript checking and `git diff --check` also passed. No live model or provider test was run.

## Limitations

Approved commands execute project code without an additional OS sandbox. Submodules are rejected. Legacy wave missions are not migrated. Uncertain launches reserve capacity until reconciled; they are never blindly duplicated. Mission artifacts are retained rather than automatically deleted.
