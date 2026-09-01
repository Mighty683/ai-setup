---
name: complex-work-orchestration
description: Coordinate complex implementation, broad refactors, migrations, risky UI or persistence work, and end-to-end delivery with dependency-aware writer waves, parallel evidence and review fanout, bounded fix loops, and one integration owner. Use when work has several dependent parts or the user asks for coordinated complex work.
---

# Complex Work Orchestration

Use this workflow in the parent Coordinator session. Children do not own orchestration, integration, or the review loop.

## 1. Establish the contract

Before mutation, establish:

- the requested outcome and non-goals;
- the authoritative source or product contract;
- the repository, branch, base commit, and pre-existing changes;
- observable acceptance behavior;
- focused checks and the highest necessary production-path validation;
- decisions that require the user.

Ask for user decisions before implementation when product behavior, architecture, authority, cost, release, or destructive operations are unresolved. Routine engineering judgments remain with the Coordinator.

## 2. Gather evidence in parallel

Call `subagent({ action: "list" })` once before the first launch. For non-trivial work, use one async `workflowScript` with a small `runs.all` fanout when the angles are genuinely independent:

- use `plan-unit` for the local evidence-backed dependency and conflict graph; it may launch one or two bounded `scout` children itself;
- add one sibling `researcher` only when current external documentation or ecosystem evidence materially affects the decision;
- when no plan is needed, the parent may instead pair a direct `scout` with a `researcher`.

Do not launch a parent `scout` beside a `plan-unit`; that duplicates local reconnaissance and can exhaust the four-child per-run admission cap once nested scouts are counted. Give each child a distinct question. Do not send clone prompts with only filenames changed. If only one useful angle exists, use one child and state why fanout would duplicate work.

## 3. Build the lane board and wave graph

Record:

`Lane | repo/cwd | exact decision | claimed files or contract | isolation | dependencies | next gate | handoff | why independent`

Every plan must include a parallelism audit:

- read-only lanes that can run together;
- writer lanes that can run together in separate Pi-managed worktrees;
- serial edges and the exact dependency or conflict causing them;
- hotspot files or contracts that prevent safe writer parallelism;
- a decomposition task when a monolith repeatedly forces unrelated changes into one seam.

Do not parallelize writers merely to keep agents busy. Use `runs.all` only when lanes have no source-seam, file, contract, generated-artifact, integration, or validation conflict. Set `worktree: true` on every concurrent writer. Keep one writer per checkout.

## 4. Execute implementation waves

The parent Coordinator launches `work-unit` children directly. A `plan-unit` may use scouts but must never launch a writer. A `review-unit` is read-only and must never launch another child.

For each writer directive, include the approved scope, named source seams, acceptance contract, production-path test expectations, validation, stop rules, and required handoff. A worker result is a candidate, not completion.

Dependent milestones stay serial. Independent mutation lanes may run in one `runs.all` wave using isolated worktrees. Integrate accepted commits one at a time in dependency order; workers do not merge or resolve semantic conflicts.

## 5. Review candidates in parallel

After each substantial writer candidate or integrated milestone, launch two to four fresh-context `review-unit` children in one `runs.all` wave. Choose distinct angles from the actual change, such as:

- correctness, invariants, and regressions;
- tests and production-path validation;
- user-flow or integration reachability;
- architecture, API, persistence, security, performance, or docs.

Prefer three strong angles over many vague reviews. Reviewers inspect the actual diff and return evidence-backed P0/P1/P2 findings. Run one expensive aggregate build or test gate separately; do not launch several full test suites that contend for the same build cache.

The Coordinator synthesizes findings once into blockers, fixes worth doing now, optional notes, and rejected or deferred feedback. Send the accepted set to one `work-unit` fix lane. Do not launch one writer per finding against the same seam.

## 6. Bound the correction loop

Default to two review rounds per milestone:

1. candidate review;
2. focused review after material fixes.

A third round requires a concrete high-risk reason. If the second round still discovers new architectural classes of failure, stop and redesign the seam or acceptance contract instead of continuing serial micro-remediation. Do not loop for optional polish.

## 7. Validate and finish

After accepted changes are integrated:

- run the focused checks affected by fixes;
- run one aggregate gate at the required spend level;
- inspect the final diff personally;
- account for every review finding;
- report changed files, commits, validation, residual risks, manual gaps, and deferred work.

A complex workflow with no parallel wave must state why every candidate lane conflicted or depended on another. This is an audit requirement, not a quota.

## Runtime rules

- Use `workflowScript`; durable `.chain.md` authoring is legacy and forbidden.
- Launch workflows asynchronously by default.
- Keep one top-level workflow per coordinated wave instead of many unrelated single-child calls.
- Do not use nested writer coordination.
- Keep the parent as sole decision-maker and integration owner.
- Preserve dirty or failed worktrees until ownership and handoff are clear.
- Do not launch fanout while Pi package installation or update work is pending; stabilize packages serially first.
