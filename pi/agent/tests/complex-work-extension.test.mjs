// Exercise command dispatch and handoff against the installed pi-subagents contracts.
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
const [rpc, notify, agents, capabilities, { default: readOnlyMode }] = await Promise.all([
  import('../node_modules/pi-subagents/src/extension/rpc.ts'),
  import('../node_modules/pi-subagents/src/runs/background/notify.ts'),
  import('../node_modules/pi-subagents/src/agents/agents.ts'),
  import('pi-subagents/capability-ceiling'),
  import('../lib/complex-work/read-only.ts'),
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
  const events = eventBus();
  const commands = new Map();
  const messages = [], notices = [], launches = [];
  const pi = {
    events,
    registerCommand: (name, command) => commands.set(name, command),
    sendMessage: (message, options) => messages.push({ ...message, options }),
    getThinkingLevel: () => 'high',
  };
  const ctx = {
    cwd: '/shared/project with spaces',
    model: { provider: 'openai-codex', id: 'gpt-5.6-terra' },
    sessionManager: { getSessionFile: () => '/sessions/current.jsonl', getSessionId: () => 'parent-session' },
    waitForIdle: async () => {},
    ui: { notify: (message, level) => notices.push({ message, level }) },
  };
  const bridge = rpc.registerSubagentRpcBridge({
    events, getContext: () => ctx,
    execute: async (_id, params) => {
      launches.push(params);
      assert.ok(messages[0].content.includes('Main agent:'), 'handoff guidance precedes the fork');
      return execute ? execute(params) : { content: [{ type: 'text', text: 'Started' }], details: { runId: `run-${launches.length}` } };
    },
  });
  const notifier = notify.default(pi, { currentSessionId: 'parent-session', completionOwnerId: 'owner' }, { batchConfig: { enabled: false } });
  t.after(() => { bridge.dispose(); notifier.dispose(); });
  extension(pi);
  return { pi, ctx, events, commands, messages, notices, launches, notifier, run: (command, args = '') => commands.get(command).handler(args, ctx) };
}

test('research command launches one fork with current model, effort, and shared cwd', async t => {
  const h = harness(t);
  assert.deepEqual([...h.commands.keys()], ['complex-work', 'complex-work-plan']);
  await h.run('complex-work', '  Investigate the cache  ');
  assert.equal(h.launches.length, 1);
  const launch = h.launches[0];
  assert.equal(launch.agent, 'research-unit');
  assert.equal(launch.context, 'fork');
  assert.equal(launch.model, 'openai-codex/gpt-5.6-terra:high');
  assert.equal(launch.cwd, h.ctx.cwd);
  assert.equal(launch.worktree, false);
  assert.equal(launch.async, true);
  assert.equal(launch.output, false);
  assert.match(launch.task, /Investigate the cache/);
  assert.match(launch.task, /may delegate read-only subtasks/);
  assert.match(h.messages[0].content, /Wait for the user to request planning/);
  assert.equal(h.messages[0].display, false, 'internal handoff instructions stay out of the chat UI');
  assert.equal(h.messages[0].options.triggerTurn, false);
  assert.match(h.notices.at(-1).message, /run-1/);
});

test('planning can start directly without arguments and waits for acceptance', async t => {
  const h = harness(t);
  await h.run('complex-work-plan');
  assert.equal(h.launches[0].agent, 'plan-unit');
  assert.equal(h.launches[0].context, 'fork');
  assert.match(h.launches[0].task, /current conversation, including prior research and user feedback/);
  assert.match(h.messages[0].content, /wait for their explicit acceptance/);
  assert.match(h.messages[0].content, /After acceptance, the main agent implements/);
  assert.match(h.messages[0].content, /finished work for user acceptance or correction/);
});

test('native completion returns research and plan results without launching another stage', async t => {
  const h = harness(t);
  for (const [command, summary] of [['complex-work', 'Research: the cache is stale.'], ['complex-work-plan', 'Plan: replace cache invalidation and verify it.']]) {
    await h.run(command);
    const count = h.launches.length;
    const result = { sessionId: 'parent-session', completionOwnerId: 'owner', runId: `run-${count}`, agent: h.launches.at(-1).agent, success: true, summary, triggerTurn: true };
    assert.equal(await h.notifier.deliver(result), true);
    const notice = h.messages.at(-1);
    assert.equal(notice.customType, 'subagent-notify');
    assert.match(notice.content, new RegExp(summary.replaceAll('.', '\\.')));
    assert.equal(notice.options.triggerTurn, true);
    assert.equal(h.launches.length, count);
    const before = h.messages.length;
    await h.notifier.deliver(result);
    assert.equal(h.messages.length, before, 'runtime deduplicates completion delivery');
  }
  assert.match(h.messages.find(message => message.content.startsWith('User requested /complex-work-plan')).content, /wait for their explicit acceptance/);
});

test('commands wait for a stable conversation before launching', async t => {
  const h = harness(t);
  let idle;
  h.ctx.waitForIdle = () => new Promise(resolve => { idle = resolve; });
  const pending = h.run('complex-work');
  assert.equal(h.launches.length, 0);
  assert.equal(h.messages.length, 0);
  idle();
  await pending;
  assert.equal(h.launches.length, 1);
});

test('research and planning can be repeated with feedback without a mission state', async t => {
  const h = harness(t);
  await h.run('complex-work');
  await h.run('complex-work-plan', 'Prefer the smaller change');
  await h.run('complex-work-plan', 'Revise the plan to keep compatibility');
  assert.equal(h.launches.length, 3);
  assert.match(h.launches[2].task, /Revise the plan to keep compatibility/);
});

test('a session that cannot be forked does not launch a fresh fallback', async t => {
  const h = harness(t);
  h.ctx.sessionManager.getSessionFile = () => undefined;
  await h.run('complex-work');
  assert.equal(h.launches.length, 0);
  assert.equal(h.messages.length, 0);
  assert.match(h.notices[0].message, /persisted conversation/);
});

test('runtime launch failures are reported and never retried', async t => {
  const h = harness(t, async () => ({ isError: true, content: [{ type: 'text', text: 'Explicit fork requires a session leaf' }], details: {} }));
  await h.run('complex-work-plan');
  assert.equal(h.launches.length, 1);
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

test('read-only mode permits research and delegation, and propagates to descendants only', () => {
  const handlers = new Map();
  readOnlyMode({ on: (event, handler) => handlers.set(event, handler) });
  const start = sessionId => handlers.get('session_start')({}, { sessionManager: { getSessionId: () => sessionId } });
  start('planning-child');
  try {
    const ceiling = capabilities.resolveSubagentCapabilityCeiling('planning-child');
    assert.ok(ceiling.allowedTools.includes('subagent'));
    assert.ok(ceiling.allowedTools.includes('web_search'));
    assert.equal(capabilities.resolveSubagentCapabilityCeiling('parent-session'), undefined);
    const inherited = capabilities.decodeSubagentCapabilityCeiling(capabilities.encodeSubagentCapabilityCeiling(ceiling));
    const descendant = capabilities.resolveSubagentCapabilityCeiling('grandchild', inherited);
    for (const toolName of ['read', 'grep', 'find', 'ls', 'web_search', 'fetch_content', 'get_search_content', 'subagent']) {
      assert.equal(handlers.get('tool_call')({ toolName }), undefined);
      assert.ok(descendant.allowedTools.includes(toolName));
    }
    for (const toolName of ['write', 'edit', 'bash', 'unknown_mutation_tool']) {
      assert.equal(handlers.get('tool_call')({ toolName }).block, true);
      assert.equal(descendant.allowedTools.includes(toolName), false);
    }
    start('replacement-child');
    assert.equal(capabilities.resolveSubagentCapabilityCeiling('planning-child'), undefined);
  } finally { handlers.get('session_shutdown')(); }
  assert.equal(capabilities.resolveSubagentCapabilityCeiling('replacement-child'), undefined);
});

test('installed agent discovery resolves delegating profiles and child-only plan mode', t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'complex-work-agents-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const agentRoot = fileURLToPath(new URL('../', import.meta.url));
  mkdirSync(path.join(cwd, '.pi/lib/complex-work'), { recursive: true });
  cpSync(path.join(agentRoot, 'agents'), path.join(cwd, '.pi/agents'), { recursive: true });
  cpSync(path.join(agentRoot, 'lib/complex-work/read-only.ts'), path.join(cwd, '.pi/lib/complex-work/read-only.ts'));
  const settings = JSON.parse(readFileSync(path.join(agentRoot, 'settings.json'), 'utf8'));
  writeFileSync(path.join(cwd, '.pi/settings.json'), JSON.stringify({ subagents: settings.subagents }));
  const discovered = agents.discoverAgents(cwd, 'project');
  assert.deepEqual(discovered.agentDiagnostics, []);
  assert.equal(settings.subagents.worktree, false);
  assert.ok(settings.subagents.maxSubagentDepth >= 3, 'work units can delegate below the main agent');
  for (const name of ['research-unit', 'plan-unit', 'work-unit']) {
    const agent = discovered.agents.find(item => item.name === name);
    assert.ok(agent, `${name} is discoverable`);
    assert.ok(agent.tools.includes('subagent'));
    assert.equal(agent.allowNestedSubagents, true);
    assert.equal(agent.defaultContext, 'fork');
    assert.match(agent.systemPrompt, /do not create worktrees/);
    if (name === 'work-unit') {
      assert.ok(agent.tools.includes('write'));
      assert.equal(agent.subagentOnlyExtensions, undefined);
    } else {
      assert.equal(agent.acceptanceRole, 'read-only');
      assert.equal(agent.tools.includes('write'), false);
      assert.equal(agent.subagentOnlyExtensions.length, 1);
      assert.ok(existsSync(agent.subagentOnlyExtensions[0]));
    }
  }
});
