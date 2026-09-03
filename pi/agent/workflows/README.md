# Complex-work workflow scripts

These scripts make the complex-work process executable while retaining one human-owned decision point between phases. They must run as mission-backed `workflowScriptPath` launches: do **not** pass `mission: false`.

Before the initial plan launch, the parent must call `subagent({ action: "list" })` and verify `plan-unit`, `lane-coordinator`, `work-unit`, and `review-unit`. The workflow sandbox cannot call management actions itself.

## Lifecycle

1. Launch `complex-work-plan.js` from the target repository with `context: "fork"`. It creates and stores a structured plan in the mission state.
2. Present `STATUS:` and `WORK PLAN:`. Do not proceed until the user says `GO`, unless continuous execution was explicitly authorized.
3. Attach later launches to the **same mission ID**. Launch `complex-work-execute-wave.js`; it selects exactly one dependency-ready wave and starts its lane coordinators.
4. Read the lane results. Cross-lane decisions remain with the root coordinator and the user. When integration is approved, launch `complex-work-integrate-wave.js`.
5. Launch `complex-work-review-wave.js`, disposition concrete findings, and run one narrowly scoped fix worker when accepted fixes are needed.
6. Only after findings are dispositioned and any fixes are checked, launch `complex-work-close-wave.js`. Repeat from step 3 for the next wave.

The lane coordinator runs one nested scout followed by one nested work-unit. It never communicates with sibling lanes. Parallel writers receive Pi-managed worktrees; the integration worker is the only writer in the active checkout.

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

Workflow scripts enforce sequencing and isolation. They cannot determine whether a review finding is valid, resolve semantic conflicts, or obtain user authority; the root coordinator must do that before the next transition.
