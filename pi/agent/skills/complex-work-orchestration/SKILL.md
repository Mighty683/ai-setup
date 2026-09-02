---
name: complex-work-orchestration
description: Coordinate complex implementation, broad refactors, migrations, risky UI or persistence work, and end-to-end delivery with clean worktree preflight, runtime-enforced verification, automatic watchdog review, dependency-aware writer waves, bounded semantic review, and one integration owner. Use when work has several dependent parts or the user asks for coordinated complex work.
---

# Complex Work Orchestration

Use this workflow in the parent Coordinator session. Children do not own orchestration, integration, or the review loop.

## 1. Preflight the checkout and freeze the contract

Before any worktree-backed launch or mutation:

- record `pwd`, the repository root, current branch, exact base commit, `git status --short`, and `git worktree list`;
- identify every pre-existing change and its owner; never make a delegated lane responsible for unrelated dirt;
- designate a persistent integration checkout and its green gate;
- if the source checkout is dirty, create or select a clean integration worktree at the approved base before launching Pi-managed writer worktrees; do not first launch and hope isolation repairs the precondition;
- read the target repository's `.pi/complex-work-gates.json`, validated against [quality-gates.schema.json](quality-gates.schema.json), or record user-approved one-off gate commands; never guess `npm test`, a Cargo package, or another project-specific command;
- verify the validation harness and any required external tool schema before scheduling expensive checks.

Publish a versioned acceptance contract, such as `CONTRACT v1`, containing:

- the requested outcome and non-goals;
- the authoritative source or product decisions;
- observable acceptance behavior and a row-by-row completion matrix;
- focused checks and the highest necessary production-path validation;
- known stale or superseded documents;
- decisions that require the user.

When the user changes semantics, increment the contract version and propagate the replacement contract to every later writer and reviewer. Ask for user decisions before implementation when product behavior, architecture, authority, cost, release, or destructive operations are unresolved. Routine engineering judgments remain with the Coordinator.

## 2. Gather evidence in parallel

Call `subagent({ action: "list" })` once before the first launch. Before passing any explicit child model, also call `subagent({ action: "models" })` and copy an exact available `provider/id`; pass the selected model on every custom `plan-unit`, `work-unit`, and `review-unit` launch rather than relying on the parent model by accident. For non-trivial work, use one async `workflowScript` with a small `runs.all` fanout when the angles are genuinely independent:

- use `plan-unit` for the local evidence-backed dependency and conflict graph; it may launch one or two bounded `scout` children itself;
- add one sibling `researcher` only when current external documentation or ecosystem evidence materially affects the decision;
- when no plan is needed, the parent may instead pair a direct `scout` with a `researcher`.

Do not launch a parent `scout` beside a `plan-unit`; that duplicates local reconnaissance and can exhaust the four-child per-run admission cap once nested scouts are counted. Give each child a distinct question. Do not send clone prompts with only filenames changed. If only one useful angle exists, use one child and state why fanout would duplicate work.

## 3. Build the lane board and wave graph

Record:

`Lane | repo/cwd | base/ref | exact decision | claimed files or contract | isolation | dependencies | green gate | handoff | why independent`

Every plan must include a parallelism audit:

- read-only lanes that can run together;
- writer lanes that can run together in separate Pi-managed worktrees;
- serial edges and the exact dependency or conflict causing them;
- hotspot files or contracts that prevent safe writer parallelism;
- a behavior-preserving decomposition task before feature work when a monolith repeatedly forces unrelated changes into one seam;
- the smallest vertical milestones that produce observable behavior without leaving the integration checkout broken.

Every milestone has a green gate. If a breaking contract requires a dependent adapter or migration, keep those candidates stacked and unintegrated until their combined gate passes, or add a temporary compatibility shim. Do not knowingly leave the designated integration branch failing between serial waves.

Do not parallelize writers merely to keep agents busy. Use `runs.all` only when lanes have no source-seam, file, contract, generated-artifact, integration, or validation conflict. For a managed `worktree: true` wave, set one clean repository checkout as the top-level workflow `cwd` and let Pi derive child worktree paths; do not set a conflicting task-level `cwd`. Use task-level `cwd` only for `worktree: false` or separate cross-repository workflows. Keep one writer per checkout.

## 4. Execute implementation waves

The parent Coordinator launches `work-unit` children directly. A `plan-unit` may use scouts but must never launch a writer. A `review-unit` is read-only and must never launch another child.

For each writer directive, include the contract version, approved scope, named source seams, designated green gate, production-path test expectations, validation, stop rules, and required handoff. Require the child to verify and report its checkout path, branch, base and `HEAD` before editing. A worker result is a candidate, not completion.

Make deterministic acceptance runtime-owned instead of relying on worker prose. Every mutation-capable launch must use either:

- `gate: "<command>"` when one host-run command is the complete gate; or
- `acceptance: { level: "verified", evidence: [...], verify: [...] }` for multiple commands, explicit timeouts, or criteria.

Copy matching focused commands verbatim from `.pi/complex-work-gates.json` into `acceptance.verify`; use each entry's repository-relative `cwd`. Never combine `gate` and `acceptance`. A non-zero exit or timeout rejects the candidate, and a child claiming that tests passed does not replace runtime verification. For example:

```javascript
acceptance: {
  level: "verified",
  evidence: ["changed-files", "residual-risks", "no-staged-files"],
  verify: [{ id: "core-tests", command: "cargo test -p core", cwd: ".", timeoutMs: 1200000 }]
}
```

Do not add `acceptance.review.required` to writer launches in this workflow: pi-subagents records `review-required` but does not launch the independent reviewer or expose a public transition for a later review receipt. Deterministic verification is complete only when `ledger.evidenceStatus === "verified"`; the factory-level receipt tracks the separate semantic review wave.

Keep mutation lanes small enough to finish safely. For mutation-capable children, do not pass `turnBudget`, a hard `toolBudget`, or a tight `usageBudget`; these are not delivery-safe checkpoints. Use a narrow slice and a generous outer runtime. When a committed handoff is required, instruct the worker to commit a scoped checkpoint after implementation and focused development checks pass, before slow optional validation, then fix or add a follow-up commit if later checks fail. Never checkpoint known failing code.

Avoid giant exact-text edits and whole-file rewrites in hotspot files. First use targeted symbol reads and small replacements; if the seam is still too large, stop and schedule behavior-preserving decomposition instead of waiting inside one oversized edit.

Dependent milestones stay serial. Independent mutation lanes may run in one `runs.all` wave using isolated worktrees. Stack dependent candidates on their prerequisite commit. Integrate accepted commits one at a time in dependency order only when the milestone's green gate remains satisfied; workers do not merge or resolve semantic conflicts.

## 5. Review candidates in parallel

The configured pi-subagents watchdog automatically performs an advisory, change-gated review at `agent_end` for parent and child writers. Treat watchdog warnings as evidence to disposition, not as deterministic acceptance or a substitute for independent semantic review. Automatic watchdog follow-ups stay disabled so hooks cannot create hidden fix loops.

After each substantial writer candidate or integrated milestone, launch one to three fresh-context `review-unit` children in one `runs.all` wave. Choose only distinct high-value angles from the actual change, such as:

- correctness, invariants, and regressions;
- tests and production-path validation;
- user-flow or integration reachability;
- architecture, API, persistence, security, performance, or docs.

Prefer three strong angles over many vague reviews. Give every reviewer the exact base/head or commit range, the authoritative contract version, the milestone green gate, expected downstream dependencies, known stale documents, and explicit out-of-scope items. Do not send multiple reviewers to rediscover the same known temporary gap.

Managed writer worktrees may be removed after Pi captures their patch and handoff. Before review, materialize the accepted commit or captured patch into a persistent candidate or integration checkout, verify its `HEAD`, and point every reviewer at that checkout. Do not send reviewers to an expired temporary path or unrelated baseline. Read-only reviewers may share the stable checkout. Deterministic commands already belong to runtime acceptance; reviewers inspect semantics and test quality rather than rerunning the same suite. Run one expensive aggregate build or test gate separately so full suites do not contend for the same cache.

The Coordinator synthesizes evidence-backed P0/P1/P2 findings once into blockers, fixes worth doing now, optional notes, and rejected or deferred feedback. Classify planned dependencies and superseded documentation against the current contract before calling them defects. Send the accepted set to one `work-unit` fix lane. Do not launch one writer per finding against the same seam.

## 6. Bound the correction loop

Default to two review rounds per milestone:

1. candidate review;
2. focused review after material fixes.

A third round requires a concrete high-risk reason. If the second round still discovers new architectural classes of failure, stop and redesign the seam or acceptance contract instead of continuing serial micro-remediation. Do not loop for optional polish.

## 7. Validate and finish

Before every parent-run validation block, print and verify the checkout path, branch, `HEAD`, and status. Use explicit working directories or repository-qualified command arguments; do not validate from an implicit shell location or reuse paths after temporary worktrees are removed.

After accepted changes are integrated:

- confirm each writer's acceptance `evidenceStatus` reached `verified` rather than relying on its textual handoff or overall review status;
- run the aggregate commands declared in `.pi/complex-work-gates.json` once on the persistent integration checkout;
- execute the strongest practical user path only after its prerequisites pass, describing external tool schemas before the first call;
- inspect the final diff personally;
- account for every review finding and every acceptance-matrix row;
- transfer or merge only within approved authority;
- report changed files, commits, validation, residual risks, manual gaps, and deferred work.

Do not call the request complete while the integration gate is red, required user-path evidence is missing, or implementation remains only in temporary/candidate worktrees. Name partial delivery accurately, such as `foundation complete` or `blocked on app migration`.

A complex workflow with no parallel wave must state why every candidate lane conflicted or depended on another. This is an audit requirement, not a quota.

## Runtime rules

- Use `workflowScript`; durable `.chain.md` authoring is legacy and forbidden.
- Launch workflows asynchronously by default.
- Keep one top-level workflow per coordinated wave instead of many unrelated single-child calls.
- Do not use nested writer coordination.
- Keep the parent as sole decision-maker and integration owner.
- Preserve dirty or failed worktrees until ownership and handoff are clear; recover useful commits or patches before disposal.
- Publish progress at contract changes, candidate handoffs, findings, integrations, blockers, and final gates. Omit routine “still running normally” updates.
- Do not pass hard turn/tool/usage budgets to mutation-capable children.
- Do not launch fanout while Pi package installation or update work is pending; stabilize packages serially first.
