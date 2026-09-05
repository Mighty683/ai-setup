// Deterministic model responses exercise the public work-ledger API.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComplexWorkEngine } from '../lib/complex-work/engine.ts';
import { DEFAULT_POLICY } from '../lib/complex-work/state.ts';
export const check = { id: 'check', command: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: 3000 };
export const brief = { summary: 'Evidence', evidence: ['src/a.ts'], constraints: [], unresolvedDecisions: [] };
export const assignment = (id, instructions = `Investigate ${id} in source`) => ({ id, name: `Assigned ${id}`, instructions });
export function task(id) {
  return { id, objective: `Implement ${id}`, resources: [{ kind: 'file', name: `src/${id}.ts`, access: 'write' }], criteria: ['works'], checks: [check] };
}
export function plan(tasks = [task('a')]) {
  return { version: 3, objective: 'Implement safely', nonGoals: [], constraints: [], acceptanceCriteria: [{ id: 'works', description: 'Production behavior works' }], tasks, finalChecks: [check] };
}
export const markdown = value => '# Evidence\n\n```json\n' + JSON.stringify(value) + '\n```';
export const review = { verdict: 'pass', coveredCriteria: ['works'], findings: [] };
export const writer = { status: 'ready', summary: 'Implemented', criteria: ['works'], blockers: [] };
export const readWork = (id, dependsOn = []) => ({ id, kind: 'agent', access: 'read', assignment: assignment(id), dependsOn });
export const writeWork = (id, taskId = 'a', extra = {}) => ({ id, kind: 'agent', access: 'write', assignment: assignment(id), taskId, dependsOn: [], ...extra });
export const checkWork = (id, input, taskId) => ({ id, kind: 'check', dependsOn: input ? [input] : [], ...(input ? { input } : {}), ...(taskId ? { taskId } : {}) });
export const reviewWork = (id, input, taskId) => ({ id, kind: 'review', assignment: assignment(id), input, dependsOn: [input], ...(taskId ? { taskId } : {}) });
export const integrateWork = (id, input, checks, reviews, taskId = 'a') => ({ id, kind: 'integrate', taskId, input, checks, reviews, dependsOn: [...new Set([input, ...checks, ...reviews])] });
export async function until(predicate, label = 'condition') {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + label);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
export async function harness(t, overrides = {}, ports = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'complex-ledger-'));
  const state = { version: 3, id: 'mission-one', rootSessionFile: '/session', stateFile: path.join(root, 'state.json'), request: 'Request',
    status: 'active', paused: false, policy: { ...DEFAULT_POLICY }, workspace: { root, source: root, repo: root, baseline: 'base', head: 'base' }, revision: 0,
    work: {}, integrations: {}, launches: 0, decisions: [], answers: [], steering: [], history: [], updatedAt: new Date().toISOString(), ...overrides };
  const launches = []; const calls = []; const saves = []; const notices = [];
  let nextRun = 0;
  const engine = new ComplexWorkEngine(state, {
    save: async state => saves.push(structuredClone(state)), notice: (...args) => notices.push(args),
    register: (_job, item) => item.name,
    prompt: async (_state, job) => JSON.stringify(job),
    prepare: async () => root,
    collect: async (_state, job, output) => ({ snapshot: { ...job.snapshot, cwd: root, candidate: job.access === 'write' ? 'candidate-' + job.id : job.snapshot.candidate },
      output, ...(job.kind === 'review' ? { review: JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)) } : {}) }),
    rpc: async (method, params) => {
      calls.push({ method, params });
      if (method === 'spawn') { const runId = 'run-' + ++nextRun; launches.push({ ...params, runId }); return { details: { runId } }; }
      return {};
    },
    local: async (_state, job) => job.kind === 'integrate'
      ? { snapshot: { ...job.snapshot, taskId: undefined, base: 'base', candidate: 'integrated-' + job.id }, head: 'integrated-' + job.id }
      : { snapshot: job.snapshot, checks: [{ check, code: 0 }] },
    deliver: async () => {},
    ...ports,
  });
  t.after(async () => { engine.dispose(); await new Promise(resolve => setTimeout(resolve, 20)); await rm(root, { recursive: true, force: true }); });
  async function complete(id, value = 'Evidence') {
    await until(() => state.work[id]?.runId, id);
    await engine.onCompletion({ runId: state.work[id].runId, success: true, state: 'complete', output: typeof value === 'string' ? value : markdown(value) });
  }
  return { state, engine, launches, calls, saves, notices, root, complete };
}
