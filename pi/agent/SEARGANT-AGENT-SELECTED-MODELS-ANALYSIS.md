# Seargant-selected models — implemented workflow

## Outcome

Seargant selects the model for every `private-recon` and `private-frontline` launch. Frontline makes the same choice when it delegates an atomic task to another `private-frontline` instance.

The selection is passed using the `pi-subagents` per-launch `model` field; Recon and Frontline have no static model pins.

## Workflow

```text
Seargant
├─ private-recon       (Seargant selects Luna or Terra)
└─ private-frontline   (Seargant selects Luna or Terra)
   └─ private-frontline unit (Frontline selects Luna or Terra)
```

The workflow is technology-agnostic: its roles are technical reconnaissance and scoped implementation, without workflow-specific tooling or source-system migration.

## Routing policy

| Task                                                             | Model                  |
| ---------------------------------------------------------------- | ---------------------- |
| bounded lookup, routine verification, atomic low-risk work       | `openai/gpt-5.6-luna`  |
| ambiguous, multi-file, integration, debugging, or high-risk work | `openai/gpt-5.6-terra` |

Seargant and Frontline choose the least capable approved model that can complete the order, pass it explicitly, and record `MODEL` plus a one-line rationale. Both report a fallback or unavailable-model failure.

## Boundary

This is prompt-directed routing. Pi supports the runtime model override, but does not provide a built-in conditional router or cost budget. If strict enforcement is required later, add an extension that accepts a tier (`fast`/`strong`), resolves it from a hard allowlist, logs the decision, and enforces budgets.
