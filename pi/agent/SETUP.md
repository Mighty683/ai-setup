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

The main LLM inspects the request and chooses assignments and dependencies. The controller records work and evidence without prescribing stages or follow-up agents. Use `/complex-work-go <revision>` to authorize proposed scope and commands. Within that authority, the LLM can queue work, inspect results, and choose corrections. Integration requires matching passing check and independent review evidence. `/complex-work-verify <revision>` applies the final reviewed patch after the LLM requests delivery.

Use `/complex-work-status`, `/complex-work-pause`, `/complex-work-resume`, `/complex-work-steer`, `/complex-work-retry`, `/complex-work-replan`, and `/complex-work-cancel` for control. Retry and replan ask the main LLM to reassess; they do not restart a fixed sequence. `/complex-work-policy {"checkpoints":"task"}` enables approval of each integration work ID. The model-facing tools expose the work ledger and accept scope, work, and delivery proposals; only user commands grant scope and delivery approval.

See [architecture, controls and limits](../../docs/complex-work.md). The old wave scripts and `finish`/`abandon` phase commands are retired. Agents are defined by the coordinating LLM and registered per operation by the extension; child agents cannot delegate. Set `PI_SOUND_DISABLED=1` to disable attention bells.

## 6. Secrets

Do not commit `auth.json`, credentials, or API keys.
