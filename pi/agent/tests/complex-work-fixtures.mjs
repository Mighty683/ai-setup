// Fixtures exercise public controller events while keeping model output deterministic.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComplexWorkEngine } from '../lib/complex-work/engine.ts';
import { DEFAULT_POLICY, freshTask } from '../lib/complex-work/state.ts';
export const check = { id: 'check', command: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: 3000 };
export const brief = { summary: 'Evidence', evidence: ['src/a.ts'], constraints: [], unresolvedDecisions: [] };
export function task(id, dependsOn = []) {
  return { id, objective: `Implement ${id}`, dependsOn, resources: [{ kind: 'file', name: `src/${id}.ts`, access: 'write' }], criteria: ['works'], checks: [check] };
}
export function plan(tasks = [task('a')]) {
  return { version: 2, objective: 'Implement safely', nonGoals: [], constraints: [], acceptanceCriteria: [{ id: 'works', description: 'The production path works' }], tasks, finalChecks: [check] };
}
export const markdown = value => '# Evidence\n\n```json\n' + JSON.stringify(value) + '\n```';
export const review = { verdict: 'pass', coveredCriteria: ['works'], findings: [] };
export const writer = { status: 'ready', summary: 'Implemented', criteria: ['works'], blockers: [] };
export async function until(predicate, label = 'condition') {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + label);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
export async function harness(t, overrides = {}, ports = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'complex-engine-'));
  const state = { version: 2, id: 'mission-one', rootSessionFile: '/session', stateFile: path.join(root, 'state.json'), request: 'Request', phase: 'awaiting-approval', paused: false,
    policy: { ...DEFAULT_POLICY }, workspace: { root, source: root, repo: root, baseline: 'base', head: 'base' }, revision: 1,
    plan: plan(), brief, errors: [], reports: {}, discoveryAttempts: {}, tasks: { a: freshTask() }, jobs: {}, launches: 0,
    finalReviews: {}, steering: [], history: [], updatedAt: new Date().toISOString(), ...overrides };
  const launches = []; const calls = []; const saves = []; const notices = [];
  let nextRun = 0;
  const engine = new ComplexWorkEngine(state, {
    save: async state => saves.push(structuredClone(state)), notice: (...args) => notices.push(args), diff: async () => '',
    rpc: async (method, params) => {
      calls.push({ method, params });
      if (method === 'spawn') { const runId = 'run-' + ++nextRun; launches.push({ ...params, runId }); return { details: { runId } }; }
      return {};
    },
    local: async (_state, job) => {
      if (job.kind === 'prepare') return { cwd: root, base: 'base' };
      if (job.kind === 'validate') return { candidate: 'candidate', checks: [{ check, code: 0 }] };
      if (job.kind === 'integrate') return { head: 'integrated-' + job.taskId };
      if (job.kind === 'final-check') return { checks: [{ check, code: 0 }] };
      return {};
    }, ...ports,
  });
  t.after(async () => { engine.dispose(); await new Promise(resolve => setTimeout(resolve, 20)); await rm(root, { recursive: true, force: true }); });
  async function complete(kind, taskId, value, angle) {
    await until(() => Object.values(state.jobs).some(job => job.kind === kind && job.taskId === taskId && (!angle || job.angle === angle) && job.runId), `${kind} ${taskId ?? ''}`);
    const job = Object.values(state.jobs).find(job => job.kind === kind && job.taskId === taskId && (!angle || job.angle === angle) && job.runId);
    await engine.onCompletion({ runId: job.runId, success: true, state: 'complete', output: typeof value === 'string' ? value : markdown(value) });
  }
  return { state, engine, launches, calls, saves, notices, root, complete };
}
