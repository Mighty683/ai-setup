# Setup

## 1. Point Pi at this folder

```bash
export PI_CODING_AGENT_DIR="..path to cloned repo.."
```

## 2. Configure providers

### Codex

Start Pi, then run `/login` and choose **ChatGPT Plus/Pro (Codex)**.

### Mistral

Use an environment variable:

```bash
export MISTRAL_API_KEY="..."
```

Or copy `auth.template.json` to `auth.json` inside this folder and fill in your key locally.

## 3. Migrate OpenCode agents

The extension auto-runs on Pi startup and reads `../opencode.json`.

Local config (auto-created):

- `extensions/opencode-migrator/config.json`

Manual command inside Pi:

- `/opencode-migrate` (run now)
- `/opencode-migrate --dry-run` (preview changes)
- `/opencode-migrate --status` (show config/status)

Generated managed agents are written to:

- `agents/*.md`

## 5. Verify

```bash
PI_CODING_AGENT_DIR="/home/might/projects/ai-setup/pi" pi
```

Inside Pi:

- `/model`
- `/opencode-migrate --status`
- `/subagents-doctor`
- `Show me the available subagents.`

## 6. Secrets

Do not commit `auth.json` or any API keys.
