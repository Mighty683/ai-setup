# Coordinator-selected models and complex-work workflow

## Outcome

The parent Coordinator owns planning, implementation waves, review synthesis, integration, and final validation. It selects a model for every `plan-unit`, `work-unit`, and `review-unit` launch through the `pi-subagents` per-launch `model` field; agent files do not statically pin a runtime model.

A `plan-unit` is read-only. It may launch bounded Luna `scout` research, but it never launches a writer. A `work-unit` is the only delegated implementation role and owns every mutation in a complex workflow. A `review-unit` is a focused read-only lane intended for fresh-context parallel review waves.

## Workflow

```text
Coordinator
├─ parallel evidence wave
│  ├─ plan-unit             dependency/conflict graph
│  │  └─ scout × 1-2        bounded local source and test seams
│  └─ researcher            external evidence when required
├─ implementation wave
│  ├─ work-unit             one writer for a shared checkout, or
│  └─ runs.all(work-unit)   only independent Pi-worktree lanes
├─ parallel review wave
│  ├─ review-unit           correctness and regressions
│  ├─ review-unit           tests and production-path evidence
│  └─ review-unit           integration/architecture/domain angle
├─ work-unit                one synthesized fix lane
└─ aggregate gate           one expensive integrated validation
```

Use `/complex-work <request>` for the repeatable workflow. It loads the `complex-work-orchestration` skill and asks the Coordinator to publish the acceptance contract, lane board, and parallelism audit before mutation. Durable `.chain.md` files are legacy and are not authored; runtime composition uses `workflowScript`, `runs.all`, and `runs.run`.

## Parallelism policy

The Coordinator records the repository baseline and lane board before mutation. Every complex plan must identify:

- independent read-only evidence and review lanes;
- independent writer lanes with explicit contracts and `worktree: true`;
- serial dependency edges with their exact reason;
- hotspot files or mutable contracts that should be decomposed before future writer fanout.

Parallelize judgment aggressively when angles are distinct. Parallelize writes conservatively. One writer owns each checkout, and the Coordinator integrates accepted commits one at a time. Full build or test gates that share a build cache run once after integration instead of concurrently.

After each substantial candidate, run two to four fresh-context `review-unit` lanes in one `runs.all` wave. Synthesize findings once and send accepted fixes to one writer. Default to two review rounds per milestone; a third requires a concrete high-risk reason.

## Routing policy

| Task | Model |
| --- | --- |
| bounded lookup, local scout, narrow test/docs review, routine verification | `openai-codex/gpt-5.6-luna` |
| ambiguous planning, cross-contract review, persistence, multi-file integration, debugging, high-risk work | `openai-codex/gpt-5.6-terra` |

The Coordinator chooses the least capable enabled OpenAI model that can complete the item and records `MODEL` plus a one-line rationale. Luna and Terra are defaults, not a hard task-tier allowlist.

## Runtime bounds

`extensions/subagent/config.json` limits nested delegation to depth 2, allowing Coordinator → plan-unit → scout while preventing deeper hidden coordination. It enforces at most four cumulative logical child admissions in each top-level workflow run and limits a parent session to three active top-level async workflows. A direct `runs.all` wave can therefore contain at most four children; a workflow that delegates nested scouts has fewer remaining admissions. These bounds prevent accidental swarms; they do not create parallelism by themselves.

Do not start a fanout while Pi is installing or updating packages. Stabilize package state serially, reload Pi, and run `/subagents-doctor` before retrying.

## Boundary

This is prompt-directed routing. `settings.json` enforces the `openai-codex/*` provider scope for subagents while OpenAI-only operation is desired; it does not impose a conditional router or cost budget.
