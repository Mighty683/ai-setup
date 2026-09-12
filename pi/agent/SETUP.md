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

Ripwire is used directly through the CLI, not a Pi extension:

```sh
RIPWIRE_REPO=redhat-et/ripwire bash -c "$(curl -fsSL https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)"
cd your-project
ripwire . --for="<the change you are about to make>"
```

The installer places the binary at `~/.local/bin/ripwire`.

## 7. Secrets

Do not commit `auth.json`, credentials, or API keys.
