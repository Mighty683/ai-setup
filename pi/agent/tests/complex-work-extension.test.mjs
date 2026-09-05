import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import extension from '../extensions/complex-work.ts';
import { atomicJson } from '../lib/complex-work/io.ts';
import { RpcError } from '../lib/complex-work/rpc.ts';
import { loadMission, saveMission } from '../lib/complex-work/store.ts';
import { assertEvidence } from '../lib/complex-work/evidence.ts';
import { harness, plan, task, brief, writer, review, until, assignment, readWork, writeWork, checkWork, reviewWork, integrateWork } from './complex-work-fixtures.mjs';

async function approve(h, value = plan()) {
  await h.engine.submitScope(brief, value);
  await h.engine.userAction('go', String(h.state.revision));
}
async function candidate(h) {
  await approve(h);
  await h.engine.submitWork([writeWork('change'), checkWork('tests', 'change', 'a'), reviewWork('inspection', 'change', 'a')]);
  await h.complete('change', writer);
  await h.complete('inspection', review);
  await until(() => h.state.work.tests.status === 'completed');
}
async function integrated(h) {
  await candidate(h);
  await h.engine.submitWork([integrateWork('merge', 'change', ['tests'], ['inspection'])]);
  await until(() => h.state.work.merge.status === 'completed');
}

test('startup and completion never invent an agent or next stage', async t => {
  const h = await harness(t);
  await h.engine.start();
  assert.equal(h.launches.length, 0);
  await h.engine.submitWork([readWork('globe')]);
  await h.complete('globe');
  assert.equal(h.state.work.globe.status, 'completed');
  assert.equal(h.launches.length, 1);
  assert.equal(Object.keys(h.state.work).length, 1);
  assert.equal(h.state.status, 'active');
});
test('model-defined dependencies allow arbitrary read work before and after a change', async t => {
  const h = await harness(t);
  await approve(h);
  await h.engine.submitWork([readWork('first'), writeWork('edit', 'a', { dependsOn: ['first'] }), readWork('measure', ['edit']), readWork('followup', ['measure'])]);
  await h.complete('first');
  await h.complete('edit', writer);
  await h.complete('measure');
  await h.complete('followup');
  assert.deepEqual(h.launches.map(item => item.agent), ['Assigned first', 'Assigned edit', 'Assigned measure', 'Assigned followup']);
  assert.equal(h.state.integrations.a, undefined);
});
test('protected work waits for current scope approval and cannot self-approve', async t => {
  const h = await harness(t);
  await assert.rejects(h.engine.submitWork([writeWork('bad')]), /scope/);
  await h.engine.submitScope(brief, plan());
  await h.engine.submitWork([writeWork('edit')]);
  assert.equal(h.state.work.edit.status, 'pending');
  assert.equal(h.launches.length, 0);
  await assert.rejects(h.engine.userAction('go', '0'), /current/);
  await h.engine.userAction('go', '1');
  await until(() => h.launches.length === 1);
  assert.ok(h.saves.some(s => s.work.edit?.status === 'running' && s.work.edit.snapshot));
});
test('failed work retains evidence and blocks dependents without automatic retries', async t => {
  const h = await harness(t);
  await approve(h);
  await h.engine.submitWork([writeWork('edit'), readWork('dependent', ['edit']), readWork('independent')]);
  await h.complete('edit', { ...writer, status: 'blocked', blockers: [{ kind: 'implementation', message: 'Needs correction' }] });
  await h.complete('independent');
  assert.equal(h.state.work.edit.status, 'failed');
  assert.ok(h.state.work.edit.result.snapshot);
  assert.equal(h.state.work.dependent.status, 'pending');
  assert.equal(h.launches.length, 2);
  await h.engine.submitWork([writeWork('correction', 'a', { input: 'edit', dependsOn: ['edit'], allowFailed: ['edit'] })]);
  await h.complete('correction', writer);
  assert.equal(h.state.work.correction.status, 'completed');
  assert.equal(h.state.work.edit.status, 'failed');
});
test('pause drains active work and resume respects the submitted graph', async t => {
  const h = await harness(t);
  await h.engine.submitWork([readWork('one'), readWork('two', ['one'])]);
  await until(() => h.launches.length === 1);
  await h.engine.userAction('pause');
  await h.complete('one');
  assert.equal(h.state.work.two.status, 'pending');
  await h.engine.userAction('resume');
  await h.complete('two');
});
test('work admission is atomic and names cannot overwrite previous results', async t => {
  const h = await harness(t);
  await assert.rejects(h.engine.submitWork([readWork('one'), readWork('two', ['missing'])]), /unknown dependency/);
  assert.equal(Object.keys(h.state.work).length, 0);
  await h.engine.submitWork([readWork('one')]); await h.complete('one');
  await assert.rejects(h.engine.submitWork([readWork('one')]), /Duplicate/);
  assert.equal(h.state.work.one.status, 'completed');
});
test('concurrency and launch budgets limit model-submitted work', async t => {
  const h = await harness(t);
  await h.engine.userAction('policy', '{"maxAgents":1,"maxLaunches":2}');
  await h.engine.submitWork([readWork('one'), readWork('two'), readWork('three')]);
  await until(() => h.launches.length === 1);
  await h.complete('one'); await h.complete('two');
  await until(() => h.state.paused);
  assert.equal(h.state.work.three.status, 'pending');
  assert.equal(h.launches.length, 2);
});
test('duplicate completion cannot overwrite a retained result or trigger additional work', async t => {
  const h = await harness(t);
  await h.engine.submitWork([readWork('one')]); await h.complete('one', 'Original');
  await h.engine.onCompletion({ runId: h.state.work.one.runId, success: true, state: 'complete', output: 'Duplicate' });
  assert.equal(h.state.work.one.result.output, 'Original'); assert.equal(h.launches.length, 1);
});
test('uncertain launches retain their slots and are not relaunched on recovery', async t => {
  let spawns = 0;
  const h = await harness(t, {}, { rpc: async method => {
    if (method === 'spawn') { spawns++; throw new RpcError('timeout', true); }
    return {};
  } });
  await h.engine.submitWork([readWork('one')]);
  await until(() => h.state.work.one.status === 'uncertain');
  await h.engine.reconcile(); await h.engine.transaction(() => {});
  assert.equal(spawns, 1);
  await assert.rejects(h.engine.userAction('resume'), /uncertain/);
});
test('lost completion is recovered from runtime status and a correlated receipt', async t => {
  const h = await harness(t, {}, { rpc: async method => method === 'spawn' ? { details: { runId: 'recovered' } }
    : { asyncSnapshot: { runs: [{ id: 'recovered', state: 'complete' }] } } });
  await h.engine.submitWork([readWork('one')]);
  await until(() => h.state.work.one.runId);
  const job = h.state.work.one;
  await atomicJson(job.receipt, { operationId: job.operationId, runId: 'recovered', role: 'read-only', state: 'answered', output: 'Recovered' });
  await h.engine.reconcile();
  assert.equal(job.status, 'completed'); assert.equal(job.result.output, 'Recovered');
});
test('cancel during spawn acknowledgement stops the late run and preserves terminal status', async t => {
  let acknowledge; const stopped = [];
  const h = await harness(t, {}, { rpc: async (method, params) => {
    if (method === 'spawn') return new Promise(resolve => { acknowledge = resolve; });
    if (method === 'stop') stopped.push(params.id);
    return {};
  } });
  await h.engine.submitWork([readWork('one')]); await until(() => acknowledge);
  await h.engine.cancel();
  acknowledge({ details: { runId: 'late' } }); await until(() => stopped.includes('late'));
  await h.engine.onCompletion({ runId: 'late', success: true, state: 'complete', output: 'Late result' });
  assert.equal(h.state.status, 'cancelled'); assert.equal(h.state.work.one.status, 'cancelled');
});
test('integration is explicitly submitted and requires both exact check and review evidence', async t => {
  const h = await harness(t);
  await candidate(h);
  assert.equal(h.state.integrations.a, undefined);
  await h.engine.submitWork([integrateWork('merge', 'change', ['tests'], ['inspection'])]);
  await until(() => h.state.work.merge.status === 'completed');
  assert.equal(h.state.integrations.a.workId, 'merge');
  assert.equal(Object.keys(h.state.work).length, 4);
  assert.equal(h.state.delivery, undefined);
});
test('a check or review for an earlier candidate cannot authorize a correction', async t => {
  const h = await harness(t);
  await candidate(h);
  await h.engine.submitWork([writeWork('correction', 'a', { dependsOn: ['change'], input: 'change' })]);
  await h.complete('correction', writer);
  await h.engine.submitWork([integrateWork('bad-merge', 'correction', ['tests'], ['inspection'])]);
  await until(() => h.state.work['bad-merge'].status === 'failed');
  assert.match(h.state.work['bad-merge'].error, /Stale/);
  assert.equal(h.state.integrations.a, undefined);
});
test('a favorable review cannot hide a blocker on the same candidate', async t => {
  const h = await harness(t);
  await candidate(h);
  await h.engine.submitWork([reviewWork('second-opinion', 'change', 'a')]);
  await h.complete('second-opinion', { ...review, verdict: 'fix', findings: [{ id: 'bug', severity: 'P1', evidence: 'src/a.ts', correction: 'Fix' }] });
  assert.throws(() => assertEvidence(h.state, h.state.work.change.result.snapshot, { checks: ['tests'], reviews: ['inspection'] }), /unresolved/);
});
test('delivery requires model-selected final evidence and separate user approval', async t => {
  const h = await harness(t);
  await integrated(h);
  await assert.rejects(h.engine.requestDelivery({ checks: ['tests'], reviews: ['inspection'] }), /Stale/);
  await h.engine.submitWork([checkWork('final-check'), reviewWork('final-review', 'final-check')]);
  await h.complete('final-review', review);
  await h.engine.requestDelivery({ checks: ['final-check'], reviews: ['final-review'] });
  assert.equal(h.state.status, 'active');
  assert.equal(h.state.delivery.status, 'requested');
  await assert.rejects(h.engine.submitWork([readWork('too-late')]), /Delivery/);
  await assert.rejects(h.engine.userAction('verify', '0'), /current/);
  await h.engine.userAction('verify', '1');
  assert.equal(h.state.status, 'completed');
});
test('changing scope invalidates approval and pending work but preserves previous results', async t => {
  const h = await harness(t);
  await approve(h);
  await h.engine.submitWork([readWork('evidence')]); await h.complete('evidence');
  await h.engine.userAction('pause');
  await h.engine.submitWork([writeWork('old-write')]);
  await h.engine.cancelWork(['old-write']);
  await h.engine.submitScope(brief, plan());
  assert.equal(h.state.revision, 2); assert.equal(h.state.approval, undefined);
  assert.equal(h.state.paused, true);
  assert.equal(h.state.work.evidence.result.output, 'Evidence');
});
test('work definitions and results survive persistence without synthesizing more work', async t => {
  const h = await harness(t);
  await h.engine.submitWork([readWork('one')]); await h.complete('one');
  const pointer = await saveMission(h.state);
  const restored = await loadMission(pointer, '/session');
  assert.equal(restored.work.one.assignment.name, 'Assigned one');
  assert.equal(restored.work.one.result.output, 'Evidence');
  assert.deepEqual(Object.keys(restored.work), ['one']);
});
test('legacy state is preserved and paused instead of translated into a work graph', async t => {
  const h = await harness(t);
  const old = { ...h.state, version: 2, phase: 'researching', jobs: {}, reports: { architecture: 'Old evidence' } };
  await atomicJson(h.state.stateFile, old);
  const restored = await loadMission({ version: 2, id: old.id, stateFile: old.stateFile, rootSessionFile: '/session' }, '/session');
  assert.equal(restored.paused, true); assert.deepEqual(restored.work, {});
  assert.equal(restored.legacy.data.reports.architecture, 'Old evidence');
});
test('one answer cannot clear multiple user decisions', async t => {
  const h = await harness(t);
  await h.engine.askDecision(['First?', 'Second?']);
  await assert.rejects(h.engine.userAction('decide', '["yes"]'), /one answer/);
  assert.equal(h.state.decisions.length, 2);
  await assert.rejects(h.engine.submitScope(brief, plan()), /pending user decisions/);
  await h.engine.askDecision(['Third?']);
  assert.deepEqual(h.state.decisions, ['First?', 'Second?', 'Third?']);
});
test('completed delivery is not replayed by periodic reconciliation', async t => {
  let deliveries = 0;
  const h = await harness(t, {}, { deliver: async () => { deliveries++; } });
  await integrated(h);
  await h.engine.submitWork([checkWork('final-check'), reviewWork('final-review', 'final-check')]);
  await h.complete('final-review', review);
  await h.engine.requestDelivery({ checks: ['final-check'], reviews: ['final-review'] });
  await h.engine.userAction('verify', '1');
  await h.engine.reconcile();
  assert.equal(h.state.delivery.status, 'completed'); assert.equal(deliveries, 1);
});
test('an explicitly acknowledged passing check can supersede a transient failure', async t => {
  const h = await harness(t, {}, { local: async (_state, job) => ({ snapshot: job.snapshot, checks: [{ ...{ check: plan().tasks[0].checks[0] }, code: job.id === 'flaky' ? 7 : 0 }] }) });
  await approve(h);
  await h.engine.submitWork([writeWork('change'), checkWork('flaky', 'change', 'a'), reviewWork('inspection', 'change', 'a')]);
  await h.complete('change', writer); await h.complete('inspection', review);
  await until(() => h.state.work.flaky.status === 'failed');
  await h.engine.submitWork([{ ...checkWork('retry-check', 'flaky', 'a'), allowFailed: ['flaky'] }]);
  await until(() => h.state.work['retry-check'].status === 'completed');
  assert.doesNotThrow(() => assertEvidence(h.state, h.state.work.change.result.snapshot, { checks: ['retry-check'], reviews: ['inspection'] }));
});
test('independent review coverage may be split between model-defined assignments', async t => {
  const graph = plan(); graph.acceptanceCriteria.push({ id: 'visual', description: 'The UI is readable' }); graph.tasks[0].criteria.push('visual');
  const h = await harness(t); await approve(h, graph);
  await h.engine.submitWork([writeWork('change'), checkWork('checks', 'change', 'a'), reviewWork('behavior', 'change', 'a'), reviewWork('visuals', 'change', 'a')]);
  await h.complete('change', { ...writer, criteria: ['works', 'visual'] });
  await h.complete('behavior', review); await h.complete('visuals', { ...review, coveredCriteria: ['visual'] });
  await until(() => h.state.work.checks.status === 'completed');
  const snapshot = h.state.work.change.result.snapshot;
  assert.throws(() => assertEvidence(h.state, snapshot, { checks: ['checks'], reviews: ['behavior'] }), /cover every/);
  assert.doesNotThrow(() => assertEvidence(h.state, snapshot, { checks: ['checks'], reviews: ['behavior', 'visuals'] }));
});
test('model tool surface distinguishes authority proposals, work and evidence', () => {
  const tools = []; const handlers = new Map(); const commands = new Map();
  extension({ registerTool: tool => tools.push(tool), on: (event, fn) => handlers.set(event, fn), events: { on() {} }, registerCommand: (name, value) => commands.set(name, value) });
  assert.deepEqual(tools.map(tool => tool.name), ['complex_work_control', 'complex_work_submit', 'complex_work_scope', 'complex_work_cancel_work', 'complex_work_delivery', 'complex_work_decision', 'complex_work_withdraw_delivery']);
  assert.match(tools[0].promptGuidelines[0], /recurring checklist, not a sequence/);
  assert.match(tools[0].promptGuidelines[0], /skip, repeat, parallelize, or revisit/);
  assert.ok(commands.has('complex-work-go')); assert.ok(commands.has('complex-work-verify'));
  handlers.get('session_shutdown')();
});
test('runtime registration uses model instructions with bounded capabilities', async () => {
  const hooks = registerHooks({ load(url, context, next) {
    if (url.endsWith('.ts') && url.includes('/node_modules/')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  } });
  let registerAgent;
  try { ({ registerAgent } = await import('pi-subagents/agents')); } finally { hooks.deregister(); }
  const { registerAssignment } = await import('../lib/complex-work/roles.ts');
  const definitions = [];
  const pi = { on() {}, registerTool() {}, events: { emit(_event, request) {
    definitions.push(request.definition);
    try { request.result = { ok: true, registration: registerAgent({ pi, name: request.name, definition: request.definition }) }; }
    catch (error) { request.result = { ok: false, error }; }
  } } };
  const registrations = [registerAssignment(pi, 'one', assignment('globe', 'Inspect transparency'), false), registerAssignment(pi, 'two', assignment('ui', 'Implement neon UI'), true)];
  try {
    assert.equal(definitions[0].systemPrompt, 'Inspect transparency');
    assert.equal(definitions[0].tools.includes('write'), false);
    assert.equal(definitions[1].systemPrompt, 'Implement neon UI');
    assert.equal(definitions[1].tools.includes('write'), true);
    for (const definition of definitions) {
      assert.equal(definition.tools.includes('bash'), false); assert.equal(definition.tools.includes('subagent'), false);
      assert.equal(definition.subagentOnlyExtensions.length, 1);
    }
  } finally { for (const registration of registrations) registration.dispose(); }
});
