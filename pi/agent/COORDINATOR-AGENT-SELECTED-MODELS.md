# Agent models and delegation

`/complex-work` and `/complex-work-plan` fork the current conversation using the main agent's selected model and thinking level. They launch `research-unit` and `plan-unit`, respectively. The plan is presented for user acceptance before implementation begins.

Research, plan, and work units can spawn subagents. The main agent and delegated agents choose useful assignments and models through the normal `subagent` tool. Pi's configured model restrictions still apply. The configured delegation depth is four; adjust `subagents.maxSubagentDepth` in `settings.json` if needed.

All agents use the shared checkout. Worktrees are disabled by default, and these commands explicitly request no isolation. Coordinate file ownership before parallel edits.

See [the command workflow](../../docs/complex-work.md).
