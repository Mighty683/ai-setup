# Seargant-selected models — implemented workflow

## Outcome

Seargant normally selects a model for every `private-recon` and `private-frontline` launch. The selection is passed using the `pi-subagents` per-launch `model` field; Recon and Frontline have no static model pins.

## Workflow

```text
Seargant (main-session orchestrator)
├─ private-recon       (Seargant selects an OpenAI model)
└─ private-frontline   (Seargant selects an OpenAI model)
```

The workflow is technology-agnostic: its roles are technical reconnaissance and scoped implementation, without workflow-specific tooling or source-system migration.

## Routing policy

| Task                                                             | Model                        |
| ---------------------------------------------------------------- | ---------------------------- |
| bounded lookup, routine verification, atomic low-risk work       | `openai-codex/gpt-5.6-luna`  |
| ambiguous, multi-file, integration, debugging, or high-risk work | `openai-codex/gpt-5.6-terra` |

Seargant chooses the least capable enabled OpenAI model that can complete the order, passes it explicitly, and records `MODEL` plus a one-line rationale. Luna and Terra are defaults, not a hard task-tier allowlist.

## Boundary

This is prompt-directed routing. `settings.json` enforces the `openai-codex/*` provider scope for subagents while OpenAI-only operation is desired; it does not impose a conditional router or cost budget.
