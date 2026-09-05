// Exercise user orders through the installed native RPC and agent discovery contracts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import extension from '../extensions/complex-work.ts';
import { spawnSubagent } from '../lib/complex-work/rpc.ts';

const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('.ts') && url.includes('/node_modules/')) {
    return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  }
  return next(url, context);
} });
const [rpc, notify, agents] = await Promise.all([
  import('../node_modules/pi-subagents/src/extension/rpc.ts'),
  import('../node_modules/pi-subagents/src/runs/background/notify.ts'),
  import('../node_modules/pi-subagents/src/agents/agents.ts'),
]);
hooks.deregister();

function eventBus() {
  const bus = new EventEmitter();
  return {
    bus,
    on(name, handler) { bus.on(name, handler); return () => bus.off(name, handler); },
    emit(name, value) { bus.emit(name, value); },
  };
}

function harness(t, execute) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'complex-work with spaces-'));
  const sessionFile = path.join(cwd, 'current.jsonl');
  writeFileSync(sessionFile, '');
  const events = eventBus();
  const commands = new Map(), handlers = new Map();
  const messages = [], notices = [], launches = [], requests = [];
  events.on('subagents:rpc:v1:request', request => requests.push(request));
  let entries = [{ type: 'message', message: { role: 'user', content: 'Investigate the cache' } }];
  let leaf = 'user-leaf';
  const pi = {
    events,
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) => { entries.push({ type: 'custom', customType, data }); leaf = 'custom-leaf'; },
    sendMessage: (message, options) => { messages.push({ ...message, options }); leaf = 'handoff-leaf'; },
    getThinkingLevel: () => 'high',
  };
  const ctx = {
    cwd,
    model: { provider: 'openai-codex', id: 'gpt-5.6-terra' },
    sessionManager: {
      getSessionFile: () => sessionFile, getSessionId: () => 'parent-session',
      getLeafId: () => leaf, getEntries: () => entries, getBranch: () => entries,
    },
    waitForIdle: async () => {},
    ui: { notify: (message, level) => notices.push({ message, level }) },
  };
  const bridge = rpc.registerSubagentRpcBridge({
    events, getContext: () => ctx,
    execute: async (_id, params) => {
      launches.push(params);
      assert.ok(messages[0].content.includes('Main agent:'), 'handoff guidance precedes launch');
      return execute ? execute(params) : { content: [{ type: 'text', text: 'Started' }], details: { runId: `run-${launches.length}` } };
    },
  });
  const notifier = notify.default(pi, { currentSessionId: 'parent-session', completionOwnerId: 'owner' }, { batchConfig: { enabled: false } });
  t.after(() => { bridge.dispose(); notifier.dispose(); rmSync(cwd, { recursive: true, force: true }); });
  extension(pi);
  return {
    pi, ctx, events, commands, messages, notices, launches, requests, notifier,
    run: (command, args = '') => commands.get(command).handler(args, ctx),
    savedEntries: () => structuredClone(entries),
    sessionStart: (nextEntries = [], nextLeaf = null) => {
      entries = nextEntries; leaf = nextLeaf;
      handlers.get('session_start')?.({}, ctx);
    },
    taskPath: () => entries.findLast(entry => entry.customType === 'complex-work-task')?.data.taskPath,
  };
}

test('canonical commands and aliases use native async RPC with inherited model and shared cwd', async t => {
  const h = harness(t);
  assert.deepEqual([...h.commands.keys()], ['research', 'plan', 'sergeant', 'complex-work', 'complex-work-plan']);
  for (const [command, agent] of [['research', 'research-unit'], ['plan', 'plan-unit'], ['sergeant', 'sergeant-unit'], ['complex-work', 'research-unit'], ['complex-work-plan', 'plan-unit']]) {
    await h.run(command, '  Investigate the cache  ');
    const launch = h.launches.at(-1);
    assert.equal(launch.agent, agent);
    assert.equal(launch.context, 'fork');
    assert.equal(launch.model, 'openai-codex/gpt-5.6-terra:high');
    assert.equal(launch.cwd, h.ctx.cwd);
    assert.equal(launch.worktree, false);
    assert.equal(h.requests.at(-1).params.isolation, 'none');
    assert.equal(launch.isolation, undefined, 'native RPC drops the legacy isolation hint; worktree:false is authoritative');
    assert.equal(launch.async, true);
    assert.equal(launch.output, false);
    assert.match(launch.task, /REQUEST: Investigate the cache/);
    assert.match(launch.task, /Delegated research is read-only/);
    assert.match(launch.task, /serialize implementation writers, even for disjoint files/);
    assert.match(launch.task, /never blindly replace the dossier/);
    assert.match(h.messages.at(-1).content, /Do not autostart another stage/);
    assert.equal(h.messages.at(-1).display, false);
    assert.equal(h.messages.at(-1).options.triggerTurn, false);
  }
  assert.equal(h.launches.length, 5);
  assert.match(h.launches[2].task, /user order authorizes execution; no separate plan approval/);
  assert.match(h.notices.at(-1).message, /run-5/);
});

test('orders can start directly and repeat with feedback on the same task, without stage gates', async t => {
  const h = harness(t);
  await h.run('sergeant');
  const taskPath = h.taskPath();
  await h.run('plan', 'Prefer the smaller change');
  await h.run('research', 'Check compatibility');
  await h.run('plan', 'Revise the plan');
  assert.equal(h.launches.length, 4);
  assert.equal(h.taskPath(), taskPath);
  assert.match(h.launches[0].task, /current conversation/);
  assert.match(h.launches[3].task, /Revise the plan/);
  assert.equal(path.dirname(taskPath), path.join(h.ctx.cwd, 'docs/tasks'));
  assert.match(path.basename(taskPath), /^\d{4}-\d{2}-\d{2}-[\da-f-]{36}\.md$/);
});

test('quoted task paths persist across commands and extension reload, restore per session and reset cleanly', async t => {
  const h = harness(t);
  await h.run('research', '--task "docs/tasks/cache work.md" Investigate caching');
  const firstPath = path.join(h.ctx.cwd, 'docs/tasks/cache work.md');
  const firstSession = h.savedEntries();
  assert.equal(h.taskPath(), firstPath);
  assert.match(h.launches[0].task, /REQUEST: Investigate caching/);
  extension(h.pi);
  await h.run('plan', 'Keep compatibility');
  assert.ok(h.launches[1].task.includes(`TASK FILE: ${firstPath}`));
  await h.run('plan', "Revise --task 'docs/tasks/other task.md' with tests");
  assert.match(h.launches[2].task, /REQUEST: Revise {2}with tests/);
  assert.equal(h.taskPath(), path.join(h.ctx.cwd, 'docs/tasks/other task.md'));
  h.sessionStart();
  await h.run('research', 'A different objective');
  const newPath = h.taskPath();
  assert.notEqual(newPath, firstPath);
  assert.equal(path.dirname(newPath), path.join(h.ctx.cwd, 'docs/tasks'));
  h.sessionStart();
  await h.run('plan', 'Another new objective');
  assert.notEqual(h.taskPath(), newPath, 'new defaults are collision-safe');
  h.sessionStart(firstSession, 'restored-leaf');
  await h.run('sergeant', 'Execute the task');
  assert.ok(h.launches.at(-1).task.includes(`TASK FILE: ${firstPath}`));
});

test('absolute paths and existing task-only orders work fresh without modifying the dossier in the command', async t => {
  const h = harness(t);
  const taskPath = path.join(h.ctx.cwd, 'human task.md');
  const dossier = '# Objective\nFix cache\n\n## Human notes\nKeep this.\n';
  writeFileSync(taskPath, dossier);
  h.sessionStart();
  h.ctx.sessionManager.getSessionFile = () => undefined;
  await h.run('sergeant', `--task "${taskPath}"`);
  assert.equal(h.launches[0].context, 'fresh');
  assert.ok(h.launches[0].task.includes(`TASK FILE: ${taskPath}`));
  assert.match(h.launches[0].task, /Use the objective and relevant instructions in the task file/);
  assert.equal(readFileSync(taskPath, 'utf8'), dossier);
  await h.run('plan');
  assert.equal(h.taskPath(), taskPath);
});

for (const missing of ['file', 'leaf', 'disk-file']) {
  test(`missing parent ${missing} selects fresh before any entries or handoff are added`, async t => {
    const h = harness(t);
    if (missing === 'file') h.ctx.sessionManager.getSessionFile = () => undefined;
    if (missing === 'leaf') h.sessionStart();
    if (missing === 'disk-file') rmSync(h.ctx.sessionManager.getSessionFile());
    await h.run('research', '--task docs/tasks/new.md Investigate stale cache');
    assert.equal(h.launches.length, 1);
    assert.equal(h.launches[0].context, 'fresh');
    assert.match(h.launches[0].task, /Fresh session: no parent conversation is inherited/);
    assert.match(h.launches[0].task, /REQUEST: Investigate stale cache/);
    assert.match(h.launches[0].task, /Save evidence-backed findings/);
    assert.match(h.launches[0].task, /TASK FILE: .*docs\/tasks\/new.md/);
    assert.doesNotMatch(h.launches[0].task, /Use the forked conversation|current conversation/);
  });
}

test('no objective, history, or existing task asks instead of launching, including metadata-only leaves', async t => {
  const h = harness(t);
  h.sessionStart();
  await h.run('research');
  h.sessionStart([{ type: 'model_change' }], 'metadata-leaf');
  await h.run('plan', '--task missing.md');
  h.sessionStart([{ type: 'custom', customType: 'complex-work-task', data: { taskPath: path.join(h.ctx.cwd, 'not-created.md') } }], 'selection-leaf');
  await h.run('sergeant');
  assert.equal(h.launches.length, 0);
  assert.equal(h.messages.length, 0);
  assert.equal(h.notices.length, 3);
  for (const notice of h.notices) assert.match(notice.message, /Provide an objective/);
});

test('text-block and compacted history support no-argument fork orders', async t => {
  const h = harness(t);
  for (const entry of [
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Fix cache' }] } },
    { type: 'compaction', summary: 'User objective: fix cache' },
    { type: 'branch_summary', summary: 'User objective: fix cache' },
  ]) {
    h.sessionStart([entry], 'history-leaf');
    await h.run('plan');
    assert.equal(h.launches.at(-1).context, 'fork');
  }
  assert.equal(h.launches.length, 3);
});

test('invalid path syntax never launches or persists a selection', async t => {
  const h = harness(t);
  for (const args of ['--task', '--task ""', '--task "unclosed path', '--task one --task two', '--task --other']) {
    await h.run('research', args);
    assert.equal(h.notices.at(-1).level, 'error');
  }
  assert.equal(h.launches.length, 0);
  assert.equal(h.taskPath(), undefined);
});

test('commands wait for idle before choosing context or launching', async t => {
  const h = harness(t);
  let idle;
  h.ctx.waitForIdle = () => new Promise(resolve => { idle = resolve; });
  const pending = h.run('research');
  assert.equal(h.launches.length, 0);
  assert.equal(h.messages.length, 0);
  idle();
  await pending;
  assert.equal(h.launches.length, 1);
});

test('model omission leaves native inheritance intact', async t => {
  const h = harness(t);
  h.ctx.model = undefined;
  await h.run('research');
  assert.equal(Object.hasOwn(h.launches[0], 'model'), false);
});

test('native completion returns all unit results without launching another stage', async t => {
  const h = harness(t);
  for (const command of ['research', 'plan', 'sergeant']) {
    await h.run(command);
    const count = h.launches.length;
    const summary = `${command}: saved task evidence`;
    const result = { sessionId: 'parent-session', completionOwnerId: 'owner', runId: `run-${count}`, agent: h.launches.at(-1).agent, success: true, summary, triggerTurn: true };
    assert.equal(await h.notifier.deliver(result), true);
    const notice = h.messages.at(-1);
    assert.equal(notice.customType, 'subagent-notify');
    assert.ok(notice.content.includes(summary));
    assert.equal(notice.options.triggerTurn, true);
    assert.equal(h.launches.length, count);
    const before = h.messages.length;
    await h.notifier.deliver(result);
    assert.equal(h.messages.length, before, 'runtime deduplicates completion delivery');
  }
});

test('native launch failures are reported and never retried or switched to fresh', async t => {
  const h = harness(t, async () => ({ isError: true, content: [{ type: 'text', text: 'Explicit fork requires a session leaf' }], details: {} }));
  await h.run('plan');
  assert.equal(h.launches.length, 1);
  assert.equal(h.launches[0].context, 'fork');
  assert.equal(h.notices.at(-1).level, 'error');
  assert.match(h.messages.at(-1).content, /Explicit fork requires a session leaf/);
  assert.equal(h.messages.at(-1).options.triggerTurn, false);
});

test('acknowledgement timeout leaves no listeners or duplicate launches', async () => {
  const events = eventBus();
  const requests = [];
  events.on('subagents:rpc:v1:request', request => requests.push(request));
  await assert.rejects(spawnSubagent({ events }, { agent: 'research-unit' }, 5), /may already be running/);
  assert.equal(requests.length, 1);
  assert.deepEqual(events.bus.eventNames(), ['subagents:rpc:v1:request']);
  events.emit(`subagents:rpc:v1:reply:${requests[0].requestId}`, { success: true, data: { details: { runId: 'late' } } });
  assert.equal(requests.length, 1);
});

test('concurrent launch acknowledgements stay correlated', async () => {
  const events = eventBus();
  const requests = [];
  events.on('subagents:rpc:v1:request', request => requests.push(request));
  const research = spawnSubagent({ events }, { agent: 'research-unit' });
  const plan = spawnSubagent({ events }, { agent: 'plan-unit' });
  for (const request of [...requests].reverse()) events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { success: true, data: { details: { runId: request.params.agent } } });
  assert.equal((await research).details.runId, 'research-unit');
  assert.equal((await plan).details.runId, 'plan-unit');
  assert.deepEqual(events.bus.eventNames(), ['subagents:rpc:v1:request']);
});

test('installed agent discovery resolves standalone artifact-writing profiles without read-only ceilings', t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'complex-work-agents-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const agentRoot = fileURLToPath(new URL('../', import.meta.url));
  mkdirSync(path.join(cwd, '.pi'), { recursive: true });
  cpSync(path.join(agentRoot, 'agents'), path.join(cwd, '.pi/agents'), { recursive: true });
  const settings = JSON.parse(readFileSync(path.join(agentRoot, 'settings.json'), 'utf8'));
  writeFileSync(path.join(cwd, '.pi/settings.json'), JSON.stringify({ subagents: settings.subagents }));
  const discovered = agents.discoverAgents(cwd, 'project');
  assert.deepEqual(discovered.agentDiagnostics, []);
  assert.equal(settings.subagents.worktree, false);
  assert.ok(settings.subagents.maxSubagentDepth >= 3);
  assert.equal(existsSync(path.join(agentRoot, 'lib/complex-work/read-only.ts')), false);
  for (const name of ['research-unit', 'plan-unit', 'sergeant-unit', 'work-unit']) {
    const agent = discovered.agents.find(item => item.name === name);
    assert.ok(agent, `${name} is discoverable`);
    for (const tool of ['subagent', 'edit', 'write']) assert.ok(agent.tools.includes(tool));
    assert.equal(agent.allowNestedSubagents, true);
    assert.equal(agent.defaultContext, 'fork');
    assert.equal(agent.acceptanceRole, 'writer');
    assert.equal(agent.subagentOnlyExtensions, undefined);
    assert.match(agent.systemPrompt, /do not create worktrees/);
    assert.match(agent.systemPrompt, /serialize implementation writers even for disjoint files/);
    if (name === 'work-unit') {
      assert.match(agent.systemPrompt, /never edit it; return completion comments/);
      continue;
    }
    assert.match(agent.systemPrompt, /ordinary subagent/);
    assert.match(agent.systemPrompt, /Honor the supplied task path/);
    assert.match(agent.systemPrompt, /Clarify ambiguous existing tasks/);
    assert.match(agent.systemPrompt, /unused collision-safe name under docs\/tasks\//);
    assert.match(agent.systemPrompt, /If no objective is available, ask/);
    assert.match(agent.systemPrompt, /Read the task file before editing/);
    assert.match(agent.systemPrompt, /human edits/);
    assert.match(agent.systemPrompt, /never blindly overwrite the whole dossier/);
    assert.match(agent.systemPrompt, /Edit only the assigned task file/);
    assert.match(agent.systemPrompt, /TASK FILE \(path\)/);
    assert.match(agent.systemPrompt, /not only (in )?chat/);
    assert.match(agent.systemPrompt, /autostart another stage/);
    if (name !== 'sergeant-unit') assert.match(agent.systemPrompt, /[Dd]elegat[^\n]*read-only|read-only[^\n]*delegat/);
    if (name === 'plan-unit') {
      for (const term of ['stable ID', 'file ownership', 'dependencies', 'acceptance criteria', 'validation commands', 'waves', 'isolation is not enforced']) assert.ok(agent.systemPrompt.includes(term), term);
    }
    if (name === 'sergeant-unit') {
      for (const term of ['sole task-file writer', 'completion comments', 'acceptance evidence', 'Stop on infrastructure errors', 'no plan exists', 'do not demand a separate plan approval']) assert.ok(agent.systemPrompt.includes(term), term);
    }
  }
});
