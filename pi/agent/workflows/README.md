# Complex work

`/complex-work <request>` starts a hybrid workflow. Code owns scheduling, role capabilities, dependency checks, recorded validation, and lifecycle transitions. Agents research, plan, implement, and review within explicit task contracts.

The old wave scripts have been retired. The extension in `../extensions/complex-work.ts` is a UI adapter; `../lib/complex-work/` contains the controller, private Git snapshots, runtime roles, command evidence, and persistence. See [the architecture and controls](../../../docs/complex-work.md).

The default policy asks for approval of the plan revision and final delivery. Independent tasks continue through local corrections without a new GO at every boundary. Set `checkpoints` to `task` when each reviewed task should require explicit approval before integration.
