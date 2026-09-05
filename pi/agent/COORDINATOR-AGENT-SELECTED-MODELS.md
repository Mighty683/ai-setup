# Coordinator model selection

The standalone `/coordinator` prompt can select models for `plan-unit`, `work-unit`, and `review-unit`. These are manually coordinated roles; the plan-unit is read-only and does not delegate.

The `/complex-work` command uses a separate deterministic controller and runtime-registered leaf roles. See [the workflow architecture](../../docs/complex-work.md). Agents cannot launch other agents or perform lifecycle transitions.

The coordinating LLM defines complex-work agents through work assignment records (`id`, `name`, `instructions`, optional `model`). Every agent or review operation can select a model; otherwise the runtime's configured model selection applies. Scope approval defines resource and command authority, while the LLM chooses the work graph and its agents. Model availability and provider restrictions remain pi-subagents responsibilities.

Set concurrency and retry limits using `/complex-work-policy`; the controller's admission budget and pi-subagents' configured runtime limits both apply. Package installation should remain serial and finish before starting agent fanout.
