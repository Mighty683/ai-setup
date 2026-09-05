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

The controller researches and compiles a task graph, then presents a revision for approval. Use `/complex-work-go <revision>` to authorize its scope and operating policy. Independent tasks run in private checkouts through focused research, implementation, checks, review, and integration. The default policy continues without per-task approval; `/complex-work-verify <revision>` applies the final reviewed patch.

Use `/complex-work-status`, `/complex-work-pause`, `/complex-work-resume`, `/complex-work-steer`, `/complex-work-retry`, `/complex-work-replan`, and `/complex-work-cancel` for control. `/complex-work-policy {"checkpoints":"task"}` enables approval before each task's integration. The model-facing control tool only reads status.

See [architecture, controls and limits](../../docs/complex-work.md). The old wave scripts and `finish`/`abandon` phase commands are retired. Runtime roles are registered by the extension and cannot delegate. Set `PI_SOUND_DISABLED=1` to disable attention bells.

## 6. Secrets

Do not commit `auth.json`, credentials, or API keys.
