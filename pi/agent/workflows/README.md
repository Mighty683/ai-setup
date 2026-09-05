# Complex-work scheduler

Complex-work is an event-driven scheduler built on pi-subagents' public in-process RPC. Its purpose is to maximize safe parallel work while removing workflow bookkeeping from the root model.

## Responsibility split

The extension owns:

- parallel research dispatch and synthesis,
- ordinary-Markdown interchange compilation and bounded repair,
- plan validation and mission seeding,
- dependency-ready and conflict-free lane scheduling,
- execution → integration → parallel review advancement,
- run-ID correlation, retries, phase persistence, and history,
- explicit GO and verification gates.

Registered agents own bounded judgment inside their roles. The root model is woken only to present a plan, resolve an authority decision, explain a blocker, obtain GO, or record user verification. Agents never receive or launch workflow filesystem paths; paths retained by the extension are private scheduler implementation details.

## Lifecycle

1. `/complex-work <request>` immediately launches four fresh read-only `scout` roles concurrently: architecture, validation, contracts, and risk.
2. Registered `research-synthesis` reconciles their reports into ordinary Markdown ending with a fenced JSON research record.
3. The extension validates that record. Format failures are repaired automatically up to a bounded retry limit. Product, architecture, authority, or safety decisions pause at `awaiting-research-decision`; implementation choices do not.
4. Registered `plan-unit` converts the resolved brief into ordinary Markdown ending with a fenced JSON machine plan. It does not use `structured_output`.
5. The extension compiles and semantically validates the plan, including IDs, dependencies, cycles, safe scope paths, parallel isolation, and conflicting concurrent claims. Invalid plans receive bounded automatic repair prompts.
6. The plan is seeded into one mission. The root presents it and waits for explicit user `GO`.
7. The execution scheduler selects all dependency-ready waves that fit its concurrency cap and do not claim the same files or contracts. Their lanes run concurrently in separate managed worktrees. A serial multi-lane wave remains serial.
8. Successful lanes are integrated by one registered `work-unit` in the active checkout, then reviewed by three fresh `review-unit` roles concurrently.
9. Passing review waits for explicit user verification. Verification and closure mark every source wave in the execution batch complete. Remaining waves return to the GO gate.
10. Mechanical failures, invalid drafts, integration blockers, and review blockers remain retryable without consuming user authorization.

## Execution contracts

Each lane runs one registered `lane-coordinator`. It performs one focused registered `scout` handoff followed by one registered `work-unit`; the work-unit is the lane's only writer. Every lane maintains one canonical `docs/tasks/<wave>-<lane>.md` record and leaves the application runnable at its boundary.

Concurrent lanes always receive distinct Pi-managed worktrees. The scheduler also checks exact scoped-file and claimed-contract collisions before batching otherwise independent ready waves. Integration is the only writer in the active checkout.

Review remains structured because the scheduler must reliably distinguish pass from block. Research and planning remain ordinary Markdown for resilience and auditability; their final fenced JSON records are compiled deterministically instead of requiring an injected `structured_output` call.

`complex-work-plan.js` is a compatibility wrapper for mission-owned callers. The normal extension lifecycle launches `plan-unit` directly by registered name and compiles its response itself.

## User-facing recovery actions

- `retry-research`: retry failed research or synthesis compilation.
- `resolve-research`: record explicit answers to unresolved research decisions.
- `retry-plan`: restart bounded plan compilation.
- `plan-complete` / `research-complete`: validated manual recovery overrides.
- `go`, `verify`, `replan`, `finish`, and `abandon`: explicit lifecycle decisions.

Top-level mechanics are controller-owned. The root model must not invoke workflow paths directly.
