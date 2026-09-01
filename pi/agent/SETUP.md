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

- `plan-unit`
- `work-unit`
- `review-unit`

Confirm these commands are visible:

- `/coordinator`
- `/complex-work`
- `/skill:complex-work-orchestration`

## 5. Use the complex workflow

For substantial implementation:

```text
/complex-work <request>
```

The command gathers evidence, creates a dependency and conflict graph, publishes a lane board and parallelism audit, then waits for `GO` before mutation unless the request explicitly authorizes continuous execution.

The workflow uses `workflowScript`; do not create durable `.chain.md` files. They are a legacy inspection format, not the current execution surface.

## 6. Secrets

Do not commit `auth.json`, credentials, or API keys.
