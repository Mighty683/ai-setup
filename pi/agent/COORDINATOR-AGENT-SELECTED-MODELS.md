# Coordinator model selection

The standalone `/coordinator` prompt can select models for `plan-unit`, `work-unit`, and `review-unit`. These are manually coordinated roles; the plan-unit is read-only and does not delegate.

The `/complex-work` command uses a separate deterministic controller and runtime-registered leaf roles. See [the workflow architecture](../../docs/complex-work.md). Agents cannot launch other agents or perform lifecycle transitions.

A complex-work task may specify an explicit `model` field for its writer. The compiler preserves it and the controller passes it as a real per-launch model setting. It is displayed with the plan before approval. Other roles use the runtime's configured model selection. Model availability and provider restrictions remain pi-subagents responsibilities.

Set concurrency and retry limits using `/complex-work-policy`; the controller's admission budget and pi-subagents' configured runtime limits both apply. Package installation should remain serial and finish before starting agent fanout.
