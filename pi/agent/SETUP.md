# Setup

## 1. Link Pi config directory to this repo

Use a symlink so `~/.pi` points to this repository `pi` folder:

```bash
ln -sfn /home/might/projects/ai-setup/pi ~/.pi
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

## 3. Verify

```bash
pi
```

Inside Pi:

- `/model`
- `/subagents-doctor`
- `Show me the available subagents.`

## 6. Secrets

Do not commit `auth.json` or any API keys.
