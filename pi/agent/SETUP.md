# Setup

## 1. Link the Pi configuration

Use a symlink so `~/.pi` points to this repository's `pi` folder:

```bash
ln -sfn /home/might/projects/ai-setup/pi ~/.pi
```

## 2. Configure OpenAI Codex

Start Pi, run `/login`, and choose **ChatGPT Plus/Pro (Codex)**.

## 3. Stabilize packages before fanout

Install or update Pi packages serially. Do not start parallel subagents while Pi is changing `~/.pi/agent/npm/node_modules`; concurrent package installers can corrupt or race the shared package directory.

After package changes, restart Pi or run `/reload`, then run:

```text
/subagents-doctor
```

## 4. Verify orchestration resources

Inside Pi:

```text
/model
/subagents-doctor
Show me the available subagents.
```

Confirm these custom agents are available:

- `research-unit`
- `plan-unit`
- `sergeant-unit`
- `work-unit`
- `review-unit`

Confirm these commands are visible:

- `/coordinator`
- `/research`
- `/plan`
- `/sergeant`
- `/complex-work` (research alias)
- `/complex-work-plan` (plan alias)

## 5. Issue independent unit orders

Use `/research [objective]` to save findings, `/plan [guidance]` to write executable assignments, and `/sergeant [guidance]` to execute through subagents and record completion evidence. All three update the same task file. Choose any order; nothing autostarts the next stage, and calling sergeant authorizes execution without an extra approval ceremony.

Each command accepts `--task "docs/tasks/my task.md"` for an explicit path. Otherwise it reuses the session's selected path (retained across reload/resume), or chooses a collision-safe name under `docs/tasks/`. Fresh sessions work with an explicit objective or existing task; no objective/history means ask, not launch. Existing task sections and human edits are preserved.

The units are also ordinary subagents callable by other agents; supply the objective and task path. Research/plan may edit only the assigned task file by prompt convention; delegated research stays read-only. Sergeant owns the execution record, workers return results. All agents share the checkout without worktrees: one writer per cwd, serialized even for disjoint files; parallelize read-only work. Do not issue overlapping writer orders.

Use Pi's normal `/subagents` interface for running agents. See [usage, implementation, and limitations](../../docs/complex-work.md).

## 6. Secrets

Do not commit `auth.json`, credentials, or API keys.
