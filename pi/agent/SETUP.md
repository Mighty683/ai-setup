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
- `work-unit`
- `review-unit`

Confirm these commands are visible:

- `/coordinator`
- `/complex-work`
- `/complex-work-plan`

## 5. Research, plan, and implement

Run `/complex-work [request]` to fork a research agent from the current conversation. Its findings return here for you to review.

Run `/complex-work-plan [guidance]` when ready for a plan. The planning agent uses the conversation, research, and feedback. The main agent presents the plan and waits for your explicit acceptance before implementing it.

After acceptance, the main agent implements and delegates useful assignments, then presents the result for your acceptance or correction. Research, planning, and work units may spawn their own subagents. All agents share the current checkout without worktrees; parallel writers coordinate file ownership.

Use Pi's normal `/subagents` interface for running agents. See [command behavior and implementation](../../docs/complex-work.md).

## 6. Secrets

Do not commit `auth.json`, credentials, or API keys.
