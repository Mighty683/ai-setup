# Complex-work workflow scripts

These scripts make the complex-work process executable while retaining one human-owned decision point between phases. They must run as mission-backed `workflowScriptPath` launches: do **not** pass `mission: false`.

Before the initial plan launch, the parent must call `subagent({ action: "list" })` and verify `plan-unit`, `lane-coordinator`, `work-unit`, and `review-unit`. The workflow sandbox cannot call management actions itself.

## Lifecycle

1. Launch `complex-work-plan.js` from the target repository with `context: "fork"`. It creates and stores a structured plan in the mission state.
2. Present `STATUS:` and `WORK PLAN:`. Do not proceed until the user says `GO`, unless continuous execution was explicitly authorized.
3. Attach later launches to the **same mission ID**. Launch `complex-work-execute-wave.js`; it selects exactly one dependency-ready wave and starts its lane coordinators. Every lane owns exactly one canonical `docs/tasks/<wave>-<lane>.md` record containing Description, Research summary, and Status (`todo`, `started`, or `finished`). The lane coordinator and its nested writer share one managed lane worktree; nested implementation worktrees are forbidden.
4. Read the lane results. A blocked lane returns control instead of pausing the workflow for supervisor contact. Cross-lane decisions remain with the root coordinator and the user. When integration is approved, launch `complex-work-integrate-wave.js`. Integration must use retained patch artifacts when a managed worktree has already been cleaned up. The integrated boundary must leave the application runnable, even when the feature remains incomplete.
5. Launch `complex-work-review-wave.js`, disposition concrete findings, and run one narrowly scoped fix worker when accepted fixes are needed.
6. After findings are dispositioned and any fixes are checked, obtain explicit user verification of the runnable wave, then launch `complex-work-verify-wave.js` and `complex-work-close-wave.js` in that order. Repeat from step 3 for the next wave.

The lane coordinator runs one nested scout followed by one nested work-unit. The work-unit writes directly in the coordinator's lane checkout with `worktree: false`; this keeps one worktree and one writer per lane while allowing the outer handoff to retain the patch. It never communicates with sibling lanes. Parallel lanes receive separate Pi-managed worktrees; the integration worker is the only writer in the active checkout. Use lane-specific Cargo target directories when checks overlap to avoid build-lock contention.

## Example invocation

```js
subagent({
  workflowScriptPath: "/home/might/.pi/agent/workflows/complex-work-plan.js",
  cwd: "/path/to/target-repository",
  async: true
});
```

Use the returned mission ID when launching later scripts:

```js
subagent({
  workflowScriptPath: "/home/might/.pi/agent/workflows/complex-work-execute-wave.js",
  cwd: "/path/to/target-repository",
  missionId: "<mission-id>",
  async: true
});
```

Workflow scripts enforce sequencing and isolation. They cannot determine whether a review finding is valid, resolve semantic conflicts, or obtain user authority; the root coordinator must do that before the next transition. The `complex-work` extension exposes the valid next transition as an opt-in tool and blocks direct out-of-order complex-work workflow launches while a session is active. Advance a phase with `complex_work_control complete` only by passing the exact successful workflow `resultStatus` requested by the control tool; failed or blocked workflows leave the current phase unchanged.
