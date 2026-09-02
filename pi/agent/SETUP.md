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
/subagents-watchdog check
/subagents-watchdog status
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

The configured watchdog runs an advisory review at the `agent_end` hook when a parent or child writer changes repository state. It does not replace deterministic gates or explicit semantic review. Automatic watchdog follow-ups are disabled to prevent hidden retry loops.

Do not add a generic test agent: host acceptance runs deterministic commands more reliably and records their evidence. Add another role only for a distinct authority boundary, such as a browser/BRP production-path specialist that owns external interaction evidence but cannot edit source.

## 5. Declare project quality gates

Complex work reads deterministic checks from the target repository's tracked `.pi/complex-work-gates.json`. Validate its shape against `~/.pi/agent/skills/complex-work-orchestration/quality-gates.schema.json`.

Example for a Rust workspace:

```json
{
  "version": 1,
  "focused": [
    {
      "id": "core-tests",
      "paths": ["crates/planet_core/**"],
      "command": "cargo +stable test -p planet_core",
      "cwd": ".",
      "timeoutMs": 1200000
    },
    {
      "id": "app-tests",
      "paths": ["crates/planet_app/**"],
      "command": "cargo +stable test -p planet_app",
      "cwd": ".",
      "timeoutMs": 1200000
    }
  ],
  "aggregate": [
    {
      "id": "workspace",
      "command": "cargo +stable test --workspace",
      "cwd": ".",
      "timeoutMs": 1800000
    }
  ]
}
```

`paths` are repository-relative glob selectors. The Coordinator copies matching focused commands verbatim into `pi-subagents` `acceptance.verify`; the runtime executes and records them after the writer. Aggregate commands run once on the persistent integration checkout. Do not infer commands from package-manager files. If this file is absent, the user must approve one-off gate commands before mutation.

## 6. Use the complex workflow

For substantial implementation:

```text
/complex-work <request>
```

The command gathers evidence, creates a dependency and conflict graph, publishes a versioned acceptance contract, lane board, green gates, and parallelism audit, then waits for `GO` before mutation unless the request explicitly authorizes continuous execution.

Before the first writer wave, verify that the designated integration checkout is clean and record its branch and base. If the source checkout contains unrelated work, create or select a clean integration worktree first; managed writer worktrees do not repair a dirty launch source. Resolve exact child model ids with `subagent({ action: "models" })` before passing model overrides.

Do not apply hard turn, tool, or tight usage budgets to mutation-capable workers. Keep work safe through narrow milestones and checkpoint commits after focused checks pass. Keep breaking dependent candidates stacked until their combined integration gate is green.

The workflow uses `workflowScript`; do not create durable `.chain.md` files. They are a legacy inspection format, not the current execution surface.

## 7. Secrets

Do not commit `auth.json`, credentials, or API keys.
