# Coordinator-selected models and complex-work workflow

## Outcome

The parent Coordinator owns planning, implementation waves, review synthesis, integration, and final validation. Before selecting models it queries the live registry with `subagent({ action: "models" })`, then passes an exact available provider/model id for every `plan-unit`, `work-unit`, and `review-unit` launch through the per-launch `model` field; agent files do not statically pin a runtime model.

A `plan-unit` is read-only. It may launch bounded Luna `scout` research, but it never launches a writer. A `work-unit` is the only delegated implementation role and owns every mutation in a complex workflow. A `review-unit` is a focused read-only lane for semantic review after the automatic watchdog pass. Deterministic verification is a runtime responsibility through pi-subagents acceptance gates, not a separate test-agent role.

## Workflow

```text
Coordinator
├─ parallel evidence wave
│  ├─ plan-unit             dependency/conflict graph
│  │  └─ scout × 1-2        bounded local source and test seams
│  └─ researcher            external evidence when required
├─ clean integration preflight
│  └─ record base, dirt ownership, worktrees, and green gate
├─ implementation wave
│  ├─ work-unit             one writer for a shared checkout, or
│  └─ runs.all(work-unit)   only independent Pi-worktree lanes
│     └─ stack breaking dependencies until their combined gate passes
├─ runtime hooks
│  ├─ acceptance.verify     deterministic host checks on the candidate
│  └─ watchdog              advisory review at agent_end, no auto-follow
├─ materialize handoff      persistent candidate checkout at exact HEAD
├─ semantic review wave
│  ├─ review-unit           correctness and regressions
│  └─ review-unit × 0-2     only distinct risk-specific angles
├─ work-unit                one synthesized fix lane
└─ aggregate gate           declared checks once on integration checkout
```

Use `/complex-work <request>` for the repeatable workflow. It loads the `complex-work-orchestration` skill and asks the Coordinator to publish the acceptance contract, lane board, and parallelism audit before mutation. Target repositories declare deterministic commands in `.pi/complex-work-gates.json`; the Coordinator copies matching commands into `acceptance.verify`, where pi-subagents executes and records them. Durable `.chain.md` files are legacy and are not authored; runtime composition uses `workflowScript`, `runs.all`, and `runs.run`.

## Parallelism policy

The Coordinator records the repository baseline, pre-existing-change ownership, clean persistent integration checkout, versioned acceptance contract, and lane board before mutation. Every complex plan must identify:

- independent read-only evidence and review lanes;
- independent writer lanes with explicit contracts and `worktree: true`;
- serial dependency edges with their exact reason;
- hotspot files or mutable contracts that should be decomposed before feature work;
- each milestone's green gate and the smallest observable vertical result;
- breaking dependency chains whose candidates must remain stacked until their combined gate passes.

Parallelize judgment aggressively when angles are distinct. Parallelize writes conservatively. One writer owns each checkout, and the Coordinator integrates accepted commits one at a time without knowingly leaving the designated integration checkout red between waves. Full build or test gates that share a build cache run once after integration instead of concurrently.

The watchdog automatically inspects changed parent and child-writer state at `agent_end`. It is advisory and cannot replace deterministic acceptance or semantic review; automatic follow-ups are disabled to avoid hidden LLM loops. After each substantial candidate, first materialize the managed commit or patch into a persistent checkout, then run one to three fresh-context `review-unit` lanes for distinct semantic risks. Every review packet names the exact stable candidate refs, runtime acceptance ledger, authoritative contract version, green gate, expected stacked dependencies, superseded documents, and out-of-scope work. Synthesize findings once and send accepted fixes to one writer. Default to two review rounds per milestone; a third requires a concrete high-risk reason.

## Routing policy

| Task | Model |
| --- | --- |
| bounded lookup, local scout, narrow test/docs review, routine verification | `openai-codex/gpt-5.6-luna` |
| ambiguous planning, cross-contract review, persistence, multi-file integration, debugging, high-risk work | `openai-codex/gpt-5.6-terra` |

The Coordinator chooses the least capable enabled OpenAI model that can complete the item, verifies its exact id against the live model registry, passes it explicitly, and records `MODEL` plus a one-line rationale. Luna and Terra are defaults, not a hard task-tier allowlist.

## Runtime bounds

`extensions/subagent/config.json` limits nested delegation to depth 2, allowing Coordinator → plan-unit → scout while preventing deeper hidden coordination. It enforces at most four cumulative logical child admissions in each top-level workflow run and limits a parent session to three active top-level async workflows. A direct `runs.all` wave can therefore contain at most four children; a workflow that delegates nested scouts has fewer remaining admissions. These bounds prevent accidental swarms; they do not create parallelism by themselves. Do not pass `turnBudget`, hard `toolBudget`, or tight `usageBudget` limits to mutation-capable children; use narrow work slices, generous elapsed runtime, and scoped checkpoint commits after focused checks pass.

Do not start a fanout while Pi is installing or updating packages. Stabilize package state serially, reload Pi, and run `/subagents-doctor` before retrying.

## Boundary

`settings.json` enforces the `openai-codex/*` provider scope and enables change-gated watchdog reviews for parent and child writers. Runtime verification comes from explicit `gate` or `acceptance.verify` launch fields; prose and child-reported test success are not acceptance. The watchdog emits advisory evidence only and does not auto-follow. There is deliberately no generic test or validation agent: add a specialist role later only when it owns a distinct external production-path tool or human-evidence contract that deterministic host commands and `review-unit` cannot cover.
