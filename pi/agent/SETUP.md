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
- `integrator-unit`
- `review-unit`

## 5. Issue orders

Use Pi's normal subagent tool. Give each unit a goal and task-file path.

Launch `sergeant-unit` in one managed worktree. It launches parallel `work-unit` workers in that same checkout with `worktree: false`. After each wave, one exclusive `integrator-unit` reviews, repairs, builds, and tests.

Research and planning use the current checkout. Nothing starts the next stage without an order.

## 6. Install Ripwire (optional)

Install the Ripwire CLI separately; the Pi `ripwire` tool wraps the installed binary for read-only task context in the current workspace:

```sh
RIPWIRE_REPO=redhat-et/ripwire bash -c "$(curl -fsSL https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)"
cd your-project
ripwire . --for="<the change you are about to make>"
```

The installer places the binary at `~/.local/bin/ripwire`. Ensure that directory is on Pi's `PATH`, then run `/reload` (or restart Pi) to load `agent/extensions/ripwire.ts`. The tool accepts a task and an optional token budget; it does not install Ripwire or expose write/command-execution flags.

## 7. Secrets

Do not commit `auth.json`, credentials, or API keys.

## 8. Complex-work MVP

Requires Pi 1.0, `pi-subagents` 0.75+, installed `pi-interview` 0.13+, and XState 5.33.2. Keep the linked `~/.pi` layout so child bridge imports resolve. For a fresh setup, install the UI runtime with `pnpm --dir ~/.pi/agent/npm add --save-exact --ignore-scripts xstate@5.33.2`. Reload after linking the new extension and `complex-*` profiles:

```text
/reload
/complex-work
```

An XState machine owns screens, selection, confirmations, pending orders, and permitted controls. Removed missions disappear from the list, with files retained; no mission banner remains in normal Pi. `/complex-work` opens a full-screen workspace: selected output and input on the left; workflow agents, statuses, and explicit actions on the right. Tab changes panels; arrows choose actions even from input; Esc returns to normal Pi without stopping agents. Reopen with bare `/complex-work`. New missions require a clean original Git checkout except workflow-owned task artifacts and run in their own retained worktree. Code-writing agents commit their scoped changes; only a separately confirmed **Merge and close task** merges into the original branch, never pushes, and retains the branch/worktree. Use **Mission options → Refresh status** after reload/restart. Read the [operator guide](../../docs/complex-work.md). Try a disposable project first; end-to-end tests and the quality pass are deferred until manual UI acceptance.
