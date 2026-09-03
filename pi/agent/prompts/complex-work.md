---
description: Execute complex work through dependency-aware headless lanes
argument-hint: "<request>"
---
# Complex Work

Command this request: $@

Use the executable workflow scripts in `~/.pi/agent/workflows/`; read `~/.pi/agent/workflows/README.md` before launching one.

1. Define the objective, non-goals, constraints, acceptance criteria, and user-owned decisions. Inspect repository status, branch, base commit, and existing changes; protect unrelated work.
2. Call `subagent({ action: "list" })` once. Verify `plan-unit`, `lane-coordinator`, `work-unit`, and `review-unit` before delegation.
3. Launch `complex-work-plan.js` as a mission-backed asynchronous `workflowScriptPath` launch from the target repository. Report its `STATUS:` and `WORK PLAN:`. Wait for `GO` unless continuous execution was explicitly authorized.
4. After `GO`, attach each transition to the same mission. Run exactly one dependency-ready execution wave, inspect its results, and resolve or escalate every cross-lane decision yourself. Lane coordinators communicate only upward; they do not negotiate with sibling lanes.
5. Approve integration only after reviewing the lane handoffs. Run the integration, fresh review, and close scripts in order. Disposition review findings before closing a wave; use one scoped `work-unit` for accepted fixes per code seam.
6. Repeat by wave. Run focused checks where useful and no more than one expensive aggregate gate after all integration. Do not run smoke, manual, or end-to-end smoke tests; the user owns them.

Before every transition, publish the relevant label: `STATUS:`, `PLAN REQUEST:`, `WORK PLAN:`, `RESULTS:`, or `PLAN UPDATE:`.

Finish by inspecting the final diff and reporting changed files, checks run, review findings, residual risks, deferred work, and exact user smoke-test steps. Be brief, exact, and evidence-backed.
