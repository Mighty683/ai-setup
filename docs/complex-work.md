# Direct research and planning commands

The extension gives the user two ways to spawn a subagent from the current conversation. Pi's existing subagent runtime owns execution, progress, completion notifications, and saved results.

## Usage

1. Run `/complex-work [request]` to fork a research agent. It returns findings for the main agent to present to you.
2. Run `/complex-work-plan [guidance]` when you want a plan. It forks a planning agent from the current conversation, including the research and your feedback. Planning can also be requested directly.
3. Read the plan and accept it or request changes. The main agent waits for your explicit acceptance before implementation.
4. After acceptance, the main agent implements the plan and delegates useful assignments. It presents the finished work for your acceptance or correction.

Arguments are optional: without them, the agent uses the current conversation. Each command launches one agent; there is no automatic transition between research, planning, and implementation. You can repeat either command with new guidance. Forking requires a persisted Pi session. The launched agent uses the current model and thinking level.

## Delegation and the shared checkout

`research-unit`, `plan-unit`, and `work-unit` can spawn subagents and collect their results. Research and planning use read-only tools, including web research and delegation. A small child extension carries the read-only tool restriction into their descendants, so delegation does not authorize implementation before plan acceptance.

All agents use the current shared checkout. Commands pass `worktree: false` and `isolation: "none"`, and the runtime settings disable worktrees by default. Implementation agents assign disjoint files before parallel edits and serialize shared files or contracts. Existing user edits stay in place.

The main agent keeps its normal tools. Waiting for acceptance is a conversational instruction, not a controller approval state. User acceptance and feedback are ordinary messages; no approval command is needed.

## Implementation

- `pi/agent/extensions/complex-work.ts` registers the two commands and records result-presentation instructions in the conversation.
- `pi/agent/lib/complex-work/rpc.ts` calls the public pi-subagents async launch API once. A launch acknowledgement timeout reports uncertainty instead of retrying.
- `pi/agent/lib/complex-work/read-only.ts` supplies the research/planning tool restriction and its inherited capability ceiling.
- `pi/agent/agents/` contains the research, planning, implementation, and review instructions.

Use Pi's normal `/subagents` interface to inspect or control running agents. Completed results wake the main agent through normal runtime notifications; it retrieves the full result when needed, presents it, and waits for the user's next instruction. Runtime artifacts provide the retained transcripts and outputs.

The old scheduler, work ledger, scope contracts, private Git snapshots, approval commands, delivery pipeline, and recovery machinery have been removed. Existing artifacts from earlier versions are not loaded or deleted.

## Validation

From `pi/agent`:

```sh
node --test --test-isolation=none tests/*.test.mjs
tsc --noEmit --skipLibCheck --target es2023 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --strict extensions/complex-work.ts lib/complex-work/*.ts
```

Tests cover command dispatch through the installed runtime's RPC validation, result delivery, fork/model/shared-checkout options, error handling, agent discovery, and inherited read-only delegation. Live provider execution is not part of the automated suite.
