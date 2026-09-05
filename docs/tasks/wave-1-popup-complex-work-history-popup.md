# Complex Work History Popup

## Description

Add a read-only TUI status overlay and deterministic non-TUI status text for `/complex-work-status`.

## Research summary

The extension persists `complex-work-state` custom entries on the current branch. TUI custom overlays use `ctx.ui.custom` and components with `render`, `handleInput`, and `invalidate`; terminal-only UI must be guarded by `ctx.mode === 'tui'`.

## Status

finished

## Acceptance criteria

- Validate and replay chronological current-branch complex-work snapshots, ignoring malformed entries and retaining the final valid snapshot.
- Show a bounded read-only TUI overlay with current state and coalesced semantic phase history/durations.
- Return deterministic text outside TUI without delegating status to the LLM.
- Preserve inactive/non-root behavior and existing transition authorization.

## Runnable-state evidence

`node --test tests/complex-work-extension.test.mjs` passes 6 tests. `npm test --force` passes 17 tests; `--force` bypasses npm's repository `devEngines` package-manager mismatch. Primary TypeScript diagnostics and `git diff --check` pass.

## Blockers

None.
