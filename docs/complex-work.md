# User-directed unit commands

Independent orders, no workflow engine or enforced approval states. Run any unit, repeat it with feedback, or change order. Nothing autostarts the next stage. Pi's native subagent runtime owns async execution, progress, completion notifications, and saved outputs.

## Usage

```text
/research Investigate stale cache entries
/plan Keep compatibility; prefer the smaller change
/sergeant

/research --task "docs/tasks/cache fix.md" Investigate invalidation
/plan --task "docs/tasks/cache fix.md" Include migration tests
/sergeant --task "docs/tasks/cache fix.md"
```

- `/research`: save evidence-backed findings, sources, assumptions, and open questions in the task file.
- `/plan`: update the **same file** with precise executable assignments: files/ownership, dependencies, waves/parallelism, acceptance criteria, and validation commands.
- `/sergeant`: execute through subagents and record status, completion comments, evidence, validation, and blockers in the **same file**. Calling it authorizes execution; no additional plan approval or prior stage is required.
- `/complex-work` and `/complex-work-plan` remain aliases for `/research` and `/plan`.

All commands accept `[--task <path>] [objective or guidance]`. Single or double quotes support paths containing spaces; relative paths resolve from the current cwd. `--task` selects a new or existing file. Without it, the command reuses the session's selected path, or chooses a date/UUID name under `docs/tasks/`. Selection is saved with Pi `appendEntry` and read from the current session on each invocation, so reload/resume restores it and new sessions do not inherit another session's selection. To start a different task within a session, supply another `--task` path.

No arguments means use the selected existing task, otherwise meaningful forked conversation history. With neither, the command asks for an objective instead of launching. The unit reads the file before editing, creates it if missing, preserves existing sections and human edits, and returns its path. The command itself does not overwrite or seed dossier contents.

A persisted parent file that exists on disk plus a current leaf selects a fork. Otherwise the command selects a fresh session **before** recording the handoff, with explicit request, task path, and role instructions; fresh launches do not claim inherited conversation history. For fresh work, supply an objective or an existing task file. Launches retain the current model/thinking level. Failures and acknowledgement timeouts are reported without catch-and-retry launches; inspect `/subagents` before retrying an uncertain start.

## Ordinary subagents and shared checkout

Other agents can call `research-unit`, `plan-unit`, and `sergeant-unit` normally using the `subagent` tool. Supply the objective and task path in the assignment, plus full instructions when using fresh context. Their profiles carry the artifact contract independently of slash commands: honor supplied paths, clarify ambiguous existing tasks, select an unused `docs/tasks/` name for a new objective, preserve existing content, and return the path.

Research and planning have `edit`/`write` for the assigned task file only by **prompt convention**, not a hard sandbox. Their obsolete blanket read-only ceiling is removed. Delegated research stays read-only and returns results; it does not edit the dossier. Sergeant is the sole task-file writer during execution; workers implement assigned source changes and return evidence for sergeant to record.

All launches request the current shared checkout with `worktree: false` and the legacy `isolation: "none"` hint. The installed native RPC drops that hint; `worktree: false` is authoritative. One writer per cwd: serialize implementation writers **even for disjoint files**, and do not update the dossier while an implementation writer runs. Parallelize read-only research/review on stable inputs. Plans may describe safe parallel implementation waves conditional on future isolation, but this setup does not provide or enforce that isolation. These are coordination instructions, not locks: users and agents must avoid overlapping writer orders, including research/plan dossier edits. Use `/subagents` to inspect running units before issuing an overlapping order. Preserve unrelated local edits; no automatic commit/push.

## Implementation and validation

- `pi/agent/extensions/complex-work.ts`: command dispatch, session task selection, and handoff instructions.
- `pi/agent/lib/complex-work/rpc.ts`: one-shot public pi-subagents native async RPC adapter.
- `pi/agent/agents/`: self-contained research, planning, sergeant, work, and review profiles.

Run LSP diagnostics on changed TypeScript before typecheck; inspect `lens_diagnostics mode=all` when available. From `pi/agent`:

```sh
node --test --test-isolation=none tests/*.test.mjs
tsc --noEmit --skipLibCheck --target es2023 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --strict extensions/complex-work.ts lib/complex-work/*.ts
```

Tests cover commands/aliases through the installed native RPC validator, task paths and session reset/restore, fresh/fork preselection, model/shared-checkout options, completion delivery without next-stage launches, failure/timeout no-retry, and discoverable artifact-writing profile contracts. Live provider execution and actual model compliance with file-ownership instructions are not part of the automated suite. Older scheduler artifacts are not loaded or deleted.
