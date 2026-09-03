---
description: Execute complex work through strict, dependency-aware delegation
argument-hint: "<request>"
---
# Complex Work

Command this request: $@

## Mission

- Define the outcome, non-goals, constraints, acceptance criteria, and decisions requiring user authority.
- Inspect repository status, branch, base commit, and existing changes. Protect unrelated work.
- Call `subagent({ action: "list" })` once before delegation. Verify `plan-unit`, `work-unit`, and `review-unit`.

## Plan

- Use one `plan-unit` for local evidence and a dependency/conflict plan. Add one `researcher` only when current external facts matter.
- Divide work into small lanes with explicit scope, files or contracts, dependencies, checks, and stop conditions.
- Parallelize only independent lanes. Serialize shared files, contracts, generated artifacts, integrations, and validation bottlenecks.
- If nothing can run in parallel, state the conflict or dependency. Do not invent parallel work.

## Execute

- Delegate mutations to `work-unit` agents. The parent owns decisions, waves, integration, and final judgment.
- Use one writer per checkout. Put concurrent writers in separate Pi-managed worktrees.
- Use one asynchronous `workflowScript` per coordinated wave. Use `runs.all` only for independent lanes. Do not create `.chain.md` files.
- Give each writer one objective, exact scope, acceptance behavior, focused checks, and required handoff.
- Treat worker output as a candidate. Integrate accepted changes one at a time in dependency order.
- Never overwrite unrelated work, hide conflicts, or let workers merge semantic conflicts without review.

## Review and Finish

- For meaningful changes, launch fresh `review-unit` agents with distinct angles. Consolidate accepted fixes into one writer per code seam.
- Limit review to two rounds unless a concrete high-risk defect requires another. Redesign instead of looping indefinitely.
- Run focused automated checks where useful. Run at most one expensive aggregate gate after integration.
- Do not run smoke, manual, or end-to-end smoke tests. The user owns them.
- Inspect the final diff. Report changed files, checks run, review findings, residual risks, deferred work, and exact user smoke-test steps.

Before mutation, publish `STATUS:` and `WORK PLAN:`. Wait for `GO` unless continuous execution was explicitly authorized. After each wave, publish `RESULTS:` and `PLAN UPDATE:`.

Be brief. Be exact. No ceremony. No drift. No unverified claims.
