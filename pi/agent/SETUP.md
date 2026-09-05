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

## 5. Use the complex workflow

For substantial implementation:

```text
/complex-work <request>
```

The extension command enables `complex_work_control` only for the active session. That tool exposes and gates the one valid workflow transition; direct out-of-order complex-work workflow launches are blocked. It gathers evidence, creates a dependency and conflict graph, publishes a lane board and parallelism audit, then waits for `GO` before mutation unless the request explicitly authorizes continuous execution.

Every lane maintains `docs/tasks/<wave>-<lane>.md` with a description, research summary, and `todo`/`started`/`finished` status. Each wave must leave the application runnable, is reviewed, and requires explicit user verification before closing.

Use `/complex-work-status`, `/complex-work-go`, `/complex-work-verify`, `/complex-work-replan`, `/complex-work-finish`, or `/complex-work-abandon` to steer common transitions. Phase-specific commands also exist for `plan`, `execute`, `integrate`, `review`, `close`, and `retry-plan`; each routes through the same gated control tool rather than bypassing workflow validation.

The workflow uses `workflowScript`; do not create durable `.chain.md` files. They are a legacy inspection format, not the current execution surface.

## 6. Secrets

Do not commit `auth.json`, credentials, or API keys.
