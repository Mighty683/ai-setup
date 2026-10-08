# Complex work

`/complex-work` runs the `complex-task` workflow with explicit user gates:

`gather-info → research → plan → implementation → review → tests → merge decision → end`

A tool-free `complex-title` agent first returns a plain-text, 3–6-word title. The controller creates the task folder and starts gather-info. Title generation is bootstrap work, not an approval gate. Every stage attempt receives fresh context and the relevant durable artifacts. Agents write Markdown findings, not structured model output. Finishing a report never advances the stage or approves work; only user actions do that. `end` is a controller action, not an agent.

## Start here

Load this repository's extension and agent profiles using the existing Pi setup. Requires Pi 1.0, `pi-subagents` 0.75+ with public event RPC, installed `pi-interview` 0.13+, and XState 5.33.2 in `~/.pi/agent/npm/node_modules`. This repository's linked `~/.pi` layout supplies the bridge's package imports.

```text
/reload
/complex-work
```

The command opens a full-screen workspace, not a floating dialog. Left: the selected stage/agent's output and findings, with task or feedback input underneath. Right: workflow stages, delegated agents and observed statuses, permitted transitions, and **Retry stage**. Select a stage or agent to view its output without changing the workflow. Output refreshes at runner message/tool boundaries and report writes, not token by token.

`Tab` switches panels; ↑/↓ select actions even while input is active. With the workflow panel focused, arrows select the output to inspect; with output focused, they scroll. `PageUp/PageDown` scroll output from any panel. `Enter` selects or submits; `Shift+Enter` adds a line. `Esc` returns to ordinary Pi without stopping, pausing, or approving work; bare `/complex-work` reopens the workspace. Feedback applies to explicit retry/return actions; it does not silently steer a running agent. Approvals require **Confirm order**; the default is **Go back**. Late evidence requires fresh confirmation.

`/complex-work` accepts no arguments. There are no steering subcommands or command-based diagnostic/automation fallback. Every task, approval, navigation, and recovery action happens inside the workspace. After reload/restart, opening the workspace reconciles saved runner evidence without blindly redispatching a saved run. Only one active task is allowed per project. Execution is owned by the originating Pi session; opening another session's task does not transfer ownership. Resume that Pi chat session before continuing its task.

## UI state machine

`ui-machine.ts` uses XState, separately from the durable SDLC controller. Screens are explicit states: **hidden**, **new mission**, **mission list**, **mission details**, **mission options**, **naming**, and **confirmation**. State tags determine visible input, workflow, output, and controls; guarded events determine which choices are allowed. Selection, drafts, focus, pending orders, and errors belong to machine context, not independent renderer flags.

A parallel **idle / working** operation region executes approved orders. Leaving the screen does not cancel that region or stop agents. Successful removal clears selection and transitions to the mission list; reopening cannot restore a removed mission. Reports and code remain on disk. There is no persistent mission banner or status in normal Pi.

Completed legacy runs can settle from matching runner/process-exit evidence even after their original session is gone. A genuinely live foreign-session writer remains protected; viewing it never transfers control or permits removal without settlement.

## Workspace actions

The mission screen shows its title, current stage/status, relevant blockers, selected output, workflow agents, permitted next/return stages, and **Retry stage**. Task IDs, storage folders, attempt counters, and model/runtime metadata stay out of the main view. **Mission options** contains pause/resume, cancellation, mission removal, stored missions, and status refresh; those menus do not show an unused feedback input. Inspect report files in your IDE.

Actions operate on the selected mission. Use **Mission options → Open stored mission** to select another task; selection alone does not start execution.

| Workspace action | Purpose |
| --- | --- |
| Start mission | Start a task from the description entered in the workspace. |
| Mission options → Remove mission | Available after opening a mission. Confirm removal from the saved list; retain reports, code, worktree, and branch. Active execution must stop and settle first. |
| Approve / Accept → next stage | Approve the displayed attempt and take the forward transition. |
| Return to a stage | Revisit any earlier visited stage with optional feedback from the input. |
| Retry stage | Start a new attempt using entered answers or corrections. |
| Pause / Resume | Stop safely or reconcile and resume a paused task. |
| Mission options → End without merging | End from implementation onward, retaining candidate work and reports. |
| Accept validation → Merge decision | Accept completed test evidence without merging or closing the task. |
| Merge and close task | Explicitly merge the committed candidate into the original branch and close only after Git success. Never push; retain branch/worktree. |
| Cancel mission — preserve work | Stop the task without discarding code or reports. |
| Open stored mission / Reopen a stage | Inspect an existing task or explicitly reopen an ended task. |
| Mission options → Refresh status | Reconcile saved runner status and ownership before further orders. |

Forward approval begins research after gather-info, planning after research, implementation after plan, review after implementation, and tests after review. At the implementation gate it records feature acceptance, not release readiness. From tests, **Accept validation → Merge decision** opens a separate closing gate; **Merge and close task** requires another explicit confirmation. Running, failed, missing, or stale evidence is not an approval. Recommendations inside reports never issue orders.

**Return to a stage** may target any earlier visited stage, not just the adjacent one. Returning, retrying, or reopening preserves old reports and code and invalidates affected downstream approvals. These actions do not roll back the checkout. Review fixes require an explicit return to implementation, followed by renewed acceptance and review. A feature defect found during tests follows the same route; a test-only correction can use **Retry stage** at tests.

Pause, cancel, or navigation during active work must settle the current run and any delegated writers before another writer starts. Resume must reconcile saved execution ownership rather than assuming an interrupted writer stopped.

## Stage responsibilities

| Stage agent | Assigned work |
| --- | --- |
| `complex-title` | Return the title only; no tools or files. |
| `complex-gather-info` | Inspect project fit and write the brief, acceptance criteria, non-goals, assumptions, and questions. |
| `complex-research` | Record code evidence, alternatives, a recommended direction, risks, and unresolved decisions. |
| `complex-plan` | Write Markdown waves with task IDs, ownership, dependencies, isolated lanes, handoffs, and integration gates; no JSON plan. |
| `complex-implementation` | Execute the approved plan, integrate changes, run approved existing checks, and report demonstration steps. |
| `complex-worker` | Implement one delegated slice in its assigned isolated checkout. |
| `complex-integrator` | Integrate completed handoffs as the exclusive serial writer. |
| `complex-review` | Inspect the accepted candidate independently; edit only its assigned findings report, never code. |
| `complex-tests` | Add approved test coverage and run relevant checks after acceptance and review; report gaps and failures. |

All eight work specialists use `interview(async:false)` for missing requirements or decisions. They batch relevant questions, recommend options with rationale, wait for answers, and retain Q&A in findings. The tool-free title namer does not interview. Headless children use a child-only proxy: the owning main Pi session presents the real `pi-interview` form. Forms use the configured browser/Glimpse/Orca interface, not a second terminal renderer. The mission panel stays available and displays interview activity.

Interviews are serialized across a coordinator and its delegates. Answers never approve a stage. Cancellation, timeout, unavailable UI, or missing bridge is a blocker, not permission to guess. Navigation shuts down pending forms; closing the panel alone does not. Request/reply records survive in `.interviews/<stage-run-id>/`. Delegates must receive the packet's `extensionBindings` unchanged. Retry feedback remains available for corrections and older report-only attempts.

The planner gets an authenticated, session-scoped registry snapshot checked through public subagent preflight. Each planned task and integration gate recommends an exact model ID, effort, rationale, and fallback. Pricing is registry metadata, not a benchmark (zero is not proof of free usage). Recommendations are advisory: approving the plan does not automatically change models. Explicit per-task model assignments require separate user orders and launch-time policy checks.

Only implementation may delegate, using `complex-worker` and `complex-integrator`. Independent concurrent writers must have isolated checkouts and exclusive report paths. One serial integrator owns integration after the writers stop. Coupled changes remain serial; never put parallel writers in a shared writable checkout. The mission packet authorizes code-writing agents to commit their own scoped changes in the candidate checkout before finishing. They never merge into the original branch, push, discard user changes, or install dependencies. The final merge is a user-controlled closing action.

Research, gather-info, and planning write only their own assigned reports. Review has the same report-only write boundary. Implementation and tests may additionally change their approved code or test files. No agent changes another execution's report or `state.json`. Implementation, its worker/integrator delegates, and tests have shell access; only implementation has the subagent tool. All profiles disable ambient extensions, skill inheritance, and native acceptance ledgers; work specialists explicitly load only the interview proxy and omit acceptance roles: an agent verdict is not an approval gate. Required subagent runtime extensions still load for implementation's approved delegation.

## Durable artifacts

Tasks live under the project's own `docs/tasks/<date>-<title>-<short-hash>/`, not the machine's absolute `/docs/tasks`. The controller chooses a safe slug and short hash; the title agent cannot select a path. The folder remains stable even if the displayed title later changes.

Example layout:

```text
docs/tasks/2026-10-07-add-workflow-controller-a1b2c3d/
  state.json
  initial-input.md
  .interviews/<stage-run-id>/<request-id>.request.json
  .interviews/<stage-run-id>/<request-id>.response.json
  01-gather-info-attempt-001.md
  01-gather-info-attempt-002.md
  02-research-attempt-001.md
  03-plan-attempt-001.md
  04-implementation-attempt-001.md
  04-worker-api-attempt-001-run-<id>.md
  04-integrator-attempt-001-run-<id>.md
  05-review-attempt-001.md
  06-tests-attempt-001.md
```

Report names illustrate the per-attempt layout; agents use the exact paths assigned by the controller. Each execution owns one findings file. The runner's authoritative output path is the assigned findings file, matching the controller's completion check. After execution settles, the controller archives the runner's final-response log separately as `*-runner-output.md`; that response is not approval evidence. Delegates must likewise set their output path to their assigned findings file, never a competing filename. Retries create new reports rather than overwriting historical evidence. Delegated handoffs must be saved at an authorized report path or transferred durably from an isolated lane.

`state.json` is controller-owned JSON, not model output. It records task identity, creation date, current stage, execution status, attempts, artifact references, transition/event history, and agents and actual models used, including title generation and delegates. User actions and approval versions remain in history; unknown runtime model metadata must remain unknown rather than being guessed from defaults. Opening an existing task uses this persisted state, not chat memory. Reports are evidence for people, never machine-readable transition instructions.

## Worktrees and closing

Each new mission starts in its own Git worktree and branch, from the original branch's committed HEAD. The original checkout must be clean except for workflow-owned `docs/tasks` artifacts; staged changes must also be committed or unstaged. The controller never stashes, resets, or snapshots unrelated uncommitted work. Worktrees are retained under `~/.local/share/pi/complex-work/worktrees/`; records and findings stay in the original project's task folder.

Code-writing agents commit before completion. Accepted tests pin the clean committed candidate; later candidate changes require renewed review/test acceptance. **Merge and close task** merges only that approved commit into the original branch, never commits unfinished candidate changes or pushes. The branch and worktree remain for inspection.

Merge conflicts or failures keep the task open. Return to normal Pi, explicitly resolve and commit the merge, then reopen `/complex-work`, refresh status, and confirm closure. No automatic conflict guesses, reset, rollback, or worktree cleanup occurs.

**Mission options → End without merging** stops execution and retains code, reports, branch, and worktree without claiming a successful merge. **Cancel mission — preserve work** records cancellation rather than success. **Open stored mission → Reopen** returns to an earlier visited stage and invalidates downstream acceptance.

## MVP limits and recovery

No automatic final candidate commit, push, rollback, new dependency installation, or prose-based pass/fail decisions. Scoped agent commits are part of the user-approved mission policy. Profile file boundaries are instructions, not an operating-system sandbox; inspect diffs and findings before acceptance.

If an active navigation order requests a stop, wait for completion, refresh execution evidence, and select the action again. Missing acknowledgements or process proof block retries deliberately. Inspect `/subagents-fleet` and saved runner evidence; never relaunch an uncertain writer. An unresolved dispatch without a saved receipt requires manual inspection/repair before reuse. If creation was interrupted and a task is `ready` with no dispatch, select it through **Open stored mission** and use **Retry stage** to start the stage. Controller/store lock directories do not expire automatically: after a crash, confirm no controller or writer remains before removing the relevant `.controller-lock` or `.mutation-lock` directory. Preserve `state.json`, bootstrap records, reports, and candidate code.

Normal Pi remains usable while mission agents work in their isolated checkout. Changes made on the original branch may affect the eventual merge; leave it clean before the closing action. Git history changes invalidate a pending merge confirmation.

Existing task folders, reports, and running attempts are preserved. `/reload` loads the new workspace; existing running attempts retain their old tools/prompts. Legacy tasks without recorded Git isolation cannot launch replacement writers or use the new merge gate. Let their existing runners settle, preserve their evidence, and start a new mission from a clean branch rather than silently moving code. Historical answers remain in reports; do not duplicate a live writer. Earlier attempts that failed with “Agent stopped without its findings file” may have only `*-runner-output.md` because of the old output-path mismatch. Preserve that evidence and retry explicitly; do not relabel it as an approved report.

To finish with a merge, inspect review/test evidence, confirm **Accept validation → Merge decision**, then separately confirm **Merge and close task**. These are user decisions, not model verdicts or a machine-verified pass.

## Validation status

Bundling, JavaScript syntax checks, Pi 1.0 extension loading, and earlier preflight for all nine agent profiles passed. The full-screen entry point and keyboard/render smoke checks passed at wide and narrow terminal widths. Manual UI acceptance and end-to-end Git/workflow evaluation remain pending; the quality pass is deferred until user acceptance. XState-backed screen transitions, confirmation, removal, reopening, wide/narrow rendering, and clearing normal-Pi widgets passed focused smoke checks through the actual command/keyboard path. Completed foreign-session recovery was verified on a disposable replica, without control RPCs or changes to the real mission. The full TypeScript check reports no workflow-source errors but still fails on the installed `pi-interview` 0.13 legacy generation-context shape. XState was installed with approval; installed extension sources were not patched. Interview option generation and the complete interactive workflow remain unverified; successful registration is not end-to-end evidence.

## Manual verification

No automated workflow tests are supplied by these resources. Verify the installed controller manually in a disposable project:

1. Start a small task. Check the safe project-relative folder, initial input, title, and controller-owned state history/model metadata.
2. Answer gather-info's interview. Confirm answers appear in its findings and completion remains at gather-info. Retry with corrections; check both attempt reports survive.
3. Advance explicitly through research and plan. Confirm Markdown waves include per-task model recommendations from the supplied catalog; neither model changes nor implementation starts automatically.
4. Inspect implementation's diff and demonstration steps. If delegation is used, confirm isolated writers and exclusive serial integration. Select **Accept feature → Review**; confirm review edits only its report.
5. Return from review to research by entering feedback and selecting **Return to research**. Check that code remains, old reports survive, and downstream approvals become stale.
6. Exercise pause/resume and reopening the saved task after restarting Pi. Verify no duplicate or overlapping writer launches.
7. End a separate task from implementation or review. Confirm early-end status and preserved artifacts; open and reopen it explicitly.
8. Complete a full task through tests, inspect commands/results and any manual demonstration, then explicitly accept tests and separately merge/close. Confirm the original branch remains unchanged before that merge, agents commit their own work, no push occurs, and the worktree/branch are retained. Also check cancel preserves work.

This manual checklist verifies the workflow controls; it does not replace the tests stage's project checks. Missing test environments or unperformed manual checks must be reported as gaps, not passing evidence.
