# Coordinator-selected models

## Outcome

The Coordinator selects a model for every `plan-unit`, `work-unit`, and nested `coordinator` launch. A `plan-unit` launches bounded read-only `scout` research with `openai-codex/gpt-5.6-luna`. Every selection is passed through the `pi-subagents` per-launch `model` field; agent files do not statically pin a runtime model.

## Workflow

```text
Coordinator
├─ plan-unit                 (uses Luna scouts; returns an evidence-backed plan)
│  └─ scout                  (read-only codebase/docs research)
├─ work-unit                 (implements one approved plan item)
└─ coordinator               (owns a bounded nested planning/execution tree)
   ├─ plan-unit
   │  └─ scout
   └─ work-unit
```

Plans may nest further coordinators when that reduces coordination risk. Each nested coordinator receives an explicit boundary, deliverable, return condition, and depth or budget limit.

## Multi-agent execution

The Coordinator is the sole implementation-wave and integration owner. It records the repository baseline and a lane board before mutation, then runs only independent writer lanes concurrently. Every concurrent writer uses Pi-managed isolation through `worktree: true`, with one writer per checkout. Dependent or overlapping lanes run sequentially.

Each lane returns its worktree and branch, changed files, commit or explicit uncommitted state, validation, assumptions, and residual risks. The Coordinator integrates accepted lanes one at a time in dependency order, escalates semantic conflicts, and runs aggregate validation on the integrated result. Worktrees remain available until their handoffs are durable and no run owns them; failed worktrees are preserved for diagnosis.

## Routing policy

| Task | Model |
| --- | --- |
| bounded lookup, routine verification, atomic low-risk work | `openai-codex/gpt-5.6-luna` |
| ambiguous, multi-file, integration, debugging, or high-risk work | `openai-codex/gpt-5.6-terra` |

The Coordinator chooses the least capable enabled OpenAI model that can complete the item, passes it explicitly, and records `MODEL` plus a one-line rationale. Luna and Terra are defaults, not a hard task-tier allowlist.

## Boundary

This is prompt-directed routing. `settings.json` enforces the `openai-codex/*` provider scope for subagents while OpenAI-only operation is desired; it does not impose a conditional router or cost budget.
