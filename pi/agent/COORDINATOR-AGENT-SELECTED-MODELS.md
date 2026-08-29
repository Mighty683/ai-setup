# Coordinator-selected models

## Outcome

The Coordinator selects a model for every `plan-unit`, `work-unit`, and nested `coordinator` launch. The selection is passed through the `pi-subagents` per-launch `model` field. Units have no static model pins.

## Workflow

```text
Coordinator
├─ plan-unit                 (returns an evidence-backed plan)
├─ work-unit                 (implements one approved plan item)
└─ coordinator               (owns a bounded nested planning/execution tree)
   ├─ plan-unit
   └─ work-unit
```

Plans may nest further coordinators when that reduces coordination risk. Each nested coordinator receives an explicit boundary, deliverable, return condition, and depth or budget limit.

## Routing policy

| Task | Model |
| --- | --- |
| bounded lookup, routine verification, atomic low-risk work | `openai-codex/gpt-5.6-luna` |
| ambiguous, multi-file, integration, debugging, or high-risk work | `openai-codex/gpt-5.6-terra` |

The Coordinator chooses the least capable enabled OpenAI model that can complete the item, passes it explicitly, and records `MODEL` plus a one-line rationale. Luna and Terra are defaults, not a hard task-tier allowlist.

## Boundary

This is prompt-directed routing. `settings.json` enforces the `openai-codex/*` provider scope for subagents while OpenAI-only operation is desired; it does not impose a conditional router or cost budget.
