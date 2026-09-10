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

The units are also ordinary subagents callable by other agents; supply the objective and task path. Research/plan may edit only the assigned task file by prompt convention; delegated research stays read-only. Sergeant owns the execution record, workers return results. Unit and nested-worker conversations use fresh context. Give each independent coherent mutation wave one managed Git worktree and one `work-unit` captain. Captains may coordinate parallel read-only specialists and explicit sequential writer handoffs in that worktree; keep one active mutation owner per wave. Separate independent wave worktrees may run concurrently, followed by a sergeant completion barrier and sequential integration. Shared-checkout, overlapping, and dependent writes remain serialized.

Use Pi's normal `/subagents` interface for running agents. See [usage, implementation, and limitations](../../docs/complex-work.md).

## 6. Install Ripwire (optional)

Ripwire is used directly through the CLI, not a Pi extension:

```sh
RIPWIRE_REPO=redhat-et/ripwire bash -c "$(curl -fsSL https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)"
cd your-project
ripwire . --for="<the change you are about to make>"
```

The installer places the binary at `~/.local/bin/ripwire`.

## 7. Secrets

Do not commit `auth.json`, credentials, or API keys.
