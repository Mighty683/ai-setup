import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import extension from '../extensions/complex-work.ts';
import { atomicJson } from '../lib/complex-work/io.ts';
import { RpcError } from '../lib/complex-work/rpc.ts';
import { freshTask } from '../lib/complex-work/state.ts';
import { harness, plan, task, brief, writer, review, until } from './complex-work-fixtures.mjs';

test('approval is user-only and stale revisions cannot start execution', async t => {
  const h = await harness(t);
  await assert.rejects(h.engine.userAction('go', '0'), /displayed plan/);
  await Promise.allSettled([h.engine.userAction('go', '1'), h.engine.userAction('go', '1')]);
  await until(() => h.launches.length === 1);
  assert.equal(h.launches.length, 1);
  assert.equal(h.launches[0].agent, 'complex-work-scout');
  assert.ok(h.saves.some(state => Object.values(state.jobs).some(job => job.kind === 'scout' && job.status === 'launching')));
});
test('research launches bounded leaf scouts then synthesis and planning', async t => {
  const h = await harness(t, { phase: 'researching', plan: undefined, brief: undefined, tasks: {}, revision: 0 });
  await h.engine.start();
  await until(() => h.launches.length === 4);
  for (const angle of ['architecture', 'validation', 'contracts', 'risks']) await h.complete('scout', undefined, 'Evidence ' + angle, angle);
  await h.complete('synthesis', undefined, brief);
  await h.complete('planner', undefined, plan());
  assert.equal(h.state.phase, 'awaiting-approval');
  assert.equal(h.state.revision, 1);
});
test('one decision answer cannot clear several outstanding decisions', async t => {
  const h = await harness(t, { phase: 'research-decision', brief: { ...brief, unresolvedDecisions: ['First?', 'Second?'] } });
  await assert.rejects(h.engine.userAction('decide', '["yes"]'), /one answer per/);
  assert.equal(h.state.brief.unresolvedDecisions.length, 2);
});
test('pause drains current work and resume continues the fixed scout-writer sequence', async t => {
  const h = await harness(t);
  await h.engine.userAction('go', '1');
  await until(() => h.launches.length === 1);
  await h.engine.userAction('pause');
  await h.complete('scout', 'a', 'Focused evidence');
  assert.equal(h.state.tasks.a.stage, 'scouted');
  assert.equal(h.launches.length, 1);
  await h.engine.userAction('resume');
  await until(() => h.launches.length === 2);
  assert.equal(h.launches[1].agent, 'complex-work-writer');
  assert.equal(h.launches[1].worktree, false);
});
test('duplicate completion does not advance or overwrite the replacement job', async t => {
  const h = await harness(t);
  await h.engine.userAction('go', '1');
  await until(() => h.launches.length === 1);
  const old = h.launches[0].runId;
  await h.complete('scout', 'a', 'Evidence');
  await until(() => h.launches.length === 2);
  await h.engine.onCompletion({ runId: old, success: true, state: 'complete', output: 'duplicate' });
  assert.equal(h.state.tasks.a.stage, 'writing');
  assert.equal(h.launches.length, 2);
});
test('known review defects return to the writer without user interruption', async t => {
  const h = await harness(t);
  await h.engine.userAction('go', '1');
  await h.complete('scout', 'a', 'Evidence');
  await h.complete('writer', 'a', writer);
  for (const angle of ['correctness', 'acceptance', 'maintainability']) await h.complete('reviewer', 'a', angle === 'correctness'
    ? { ...review, verdict: 'fix', findings: [{ id: 'bug', severity: 'P1', evidence: 'src/a.ts:1', correction: 'Handle null' }] } : review, angle);
  await until(() => h.state.tasks.a.stage === 'writing');
  assert.equal(h.state.tasks.a.repairs, 1);
  assert.equal(h.notices.some(([message]) => message.includes('needs a decision')), false);
});
test('failed branch does not stop independent work or admit its dependent', async t => {
  const h = await harness(t, { plan: plan([task('a'), task('b'), task('c', ['a'])]), tasks: { a: freshTask(), b: freshTask(), c: freshTask() } });
  await h.engine.userAction('go', '1');
  await h.complete('scout', 'a', 'A'); await h.complete('scout', 'b', 'B');
  await h.complete('writer', 'a', { ...writer, status: 'blocked', blockers: [{ kind: 'decision', message: 'Need scope change' }] });
  await h.complete('writer', 'b', writer);
  for (const angle of ['correctness', 'acceptance', 'maintainability']) await h.complete('reviewer', 'b', review, angle);
  await until(() => h.state.tasks.b.stage === 'done');
  assert.equal(h.state.tasks.a.stage, 'blocked'); assert.equal(h.state.tasks.c.stage, 'pending');
});
test('lost completion is recovered using runtime status and a durable child receipt', async t => {
  const h = await harness(t, {}, { rpc: async (method) => method === 'spawn' ? { details: { runId: 'recovered' } }
    : { asyncSnapshot: { runs: [{ id: 'recovered', state: 'complete' }] } } });
  await h.engine.userAction('go', '1');
  await until(() => Object.values(h.state.jobs).some(job => job.runId === 'recovered'));
  await h.engine.userAction('pause');
  const job = Object.values(h.state.jobs).find(job => job.runId === 'recovered');
  await atomicJson(job.receipt, { operationId: job.id, runId: 'recovered', role: 'scout', state: 'answered', output: 'Recovered evidence' });
  await h.engine.reconcile();
  assert.equal(h.state.tasks.a.scout, 'Recovered evidence'); assert.equal(h.state.tasks.a.stage, 'scouted');
});
test('uncertain spawn retains its reservation and is never automatically duplicated', async t => {
  let count = 0;
  const h = await harness(t, {}, { rpc: async () => { count++; throw new RpcError('timeout', true); } });
  await h.engine.userAction('go', '1');
  await until(() => Object.values(h.state.jobs).some(job => job.status === 'uncertain'));
  await h.engine.transaction(() => {});
  await assert.rejects(h.engine.userAction('resume'), /uncertain/);
  assert.equal(count, 1);
});
test('controller tool exposes status only and blocks inline orchestration', () => {
  const tools = []; const handlers = new Map(); const commands = new Map();
  extension({ registerTool: tool => tools.push(tool), on: (event, fn) => handlers.set(event, fn), events: { on() {} }, registerCommand: (name, value) => commands.set(name, value) });
  assert.equal(tools[0].parameters.properties.action.const, 'status');
  assert.ok(commands.has('complex-work-pause')); assert.ok(commands.has('complex-work-verify'));
  handlers.get('session_shutdown')();
});

test('a complete task reaches final delivery without another GO and requires explicit delivery approval', async t => {
  const h = await harness(t);
  await h.engine.userAction('go', '1');
  await h.complete('scout', 'a', 'Evidence'); await h.complete('writer', 'a', writer);
  for (const angle of ['correctness', 'acceptance', 'maintainability']) await h.complete('reviewer', 'a', review, angle);
  for (const angle of ['correctness', 'acceptance', 'maintainability']) await h.complete('reviewer', undefined, review, angle);
  assert.equal(h.state.phase, 'awaiting-delivery');
  await assert.rejects(h.engine.userAction('verify', '0'), /current reviewed revision/);
  await h.engine.userAction('verify', '1');
  await until(() => h.state.phase === 'completed');
});
test('task checkpoints keep reviewed work ready until user approval', async t => {
  const h = await harness(t);
  await h.engine.userAction('policy', '{"checkpoints":"task"}');
  await h.engine.userAction('go', '1');
  await h.complete('scout', 'a', 'Evidence'); await h.complete('writer', 'a', writer);
  for (const angle of ['correctness', 'acceptance', 'maintainability']) await h.complete('reviewer', 'a', review, angle);
  assert.equal(h.state.tasks.a.stage, 'ready');
  await h.engine.userAction('approve-task', 'a'); await until(() => h.state.tasks.a.stage === 'done');
});
test('cancellation during spawn acknowledgement stops the late run and cannot advance the mission', async t => {
  let acknowledge; const stopped = [];
  const h = await harness(t, {}, { rpc: async (method, params) => {
    if (method === 'spawn') return new Promise(resolve => { acknowledge = resolve; });
    if (method === 'stop') stopped.push(params.id);
    return {};
  } });
  await h.engine.userAction('go', '1'); await until(() => acknowledge);
  await h.engine.cancel(); acknowledge({ details: { runId: 'late-run' } });
  await until(() => stopped.includes('late-run'));
  await h.engine.onCompletion({ runId: 'late-run', success: true, state: 'complete', output: 'Late evidence' });
  assert.equal(h.state.phase, 'cancelled'); assert.equal(Object.keys(h.state.jobs).length, 0);
});
test('final review corrections invalidate the owning task and dependent evidence', async t => {
  const h = await harness(t);
  await h.engine.userAction('go', '1');
  await h.complete('scout', 'a', 'Evidence'); await h.complete('writer', 'a', writer);
  for (const angle of ['correctness', 'acceptance', 'maintainability']) await h.complete('reviewer', 'a', review, angle);
  await until(() => h.state.phase === 'final-review');
  await h.engine.userAction('pause');
  for (const angle of ['correctness', 'acceptance', 'maintainability']) await h.complete('reviewer', undefined, angle === 'correctness'
    ? { ...review, verdict: 'fix', findings: [{ id: 'final-bug', taskId: 'a', severity: 'P1', evidence: 'src/a.ts:1', correction: 'Fix null handling' }] } : review, angle);
  assert.equal(h.state.phase, 'running'); assert.equal(h.state.tasks.a.stage, 'pending');
  assert.equal(h.state.tasks.a.repairs, 1); assert.equal(h.state.tasks.a.candidate, undefined);
  assert.equal(h.state.finalChecks, undefined);
});
test('reusing a completed task id in a replacement plan does not skip new work', async t => {
  const h = await harness(t, { tasks: { a: { ...freshTask(), stage: 'done' } } });
  await h.engine.userAction('replan', 'Change acceptance');
  await h.complete('planner', undefined, plan());
  assert.equal(h.state.tasks.a.stage, 'pending'); assert.equal(h.state.revision, 2); assert.equal(h.state.approval, undefined);
});
test('runtime registration validates actual role definitions and excludes shell and delegation', async () => {
  const hooks = registerHooks({ load(url, context, next) {
    if (url.endsWith('.ts') && url.includes('/node_modules/')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  } });
  let registerAgent;
  try { ({ registerAgent } = await import('pi-subagents/agents')); }
  finally { hooks.deregister(); }
  const { registerRoles } = await import('../lib/complex-work/roles.ts');
  const definitions = [];
  const pi = { on() {}, registerTool() {}, events: { emit(_event, request) {
    definitions.push(request.definition);
    try { request.result = { ok: true, registration: registerAgent({ pi, name: request.name, definition: request.definition }) }; }
    catch (error) { request.result = { ok: false, error }; }
  } } };
  const dispose = registerRoles(pi);
  try {
    assert.equal(definitions.length, 5);
    for (const definition of definitions) {
      assert.equal(definition.tools.includes('bash'), false); assert.equal(definition.tools.includes('subagent'), false);
      assert.equal(definition.subagentOnlyExtensions.length, 1);
    }
  } finally { dispose(); }
});
