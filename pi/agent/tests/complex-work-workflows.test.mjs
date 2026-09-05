// Repository-level integration tests use real Git snapshots, command processes, and patch delivery.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git, createWorkspace, createCheckout, checkpoint, assertScope, integrationCandidate, adopt, deliver, head } from '../lib/complex-work/git.ts';
import { writablePath } from '../lib/complex-work/child.ts';
import { durableCheck } from '../lib/complex-work/checks.ts';
import { runLocal } from '../lib/complex-work/engine.ts';
import { DEFAULT_POLICY } from '../lib/complex-work/state.ts';
import { prepareAgent, collectAgentResult } from '../lib/complex-work/execution.ts';
import { plan, task, check, harness, brief, writer, review, until, writeWork, checkWork, reviewWork, integrateWork } from './complex-work-fixtures.mjs';

async function repo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'complex-git-'));
  const source = path.join(root, 'source'); await mkdir(source);
  await git(source, ['init', '-b', 'main']);
  await writeFile(path.join(source, '.gitignore'), 'target/\nnode_modules/\n');
  await mkdir(path.join(source, 'src')); await writeFile(path.join(source, 'src/a.ts'), 'old\n');
  await writeFile(path.join(source, 'src/b.ts'), 'original b\n');
  await git(source, ['add', '.']); await git(source, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, source };
}
const resources = [{ kind: 'directory', name: 'src', access: 'write' }];
test('dirty input snapshot preserves source HEAD, index and untracked work', async t => {
  const { root, source } = await repo(t);
  await writeFile(path.join(source, 'src/a.ts'), 'staged\n'); await git(source, ['add', 'src/a.ts']);
  await writeFile(path.join(source, 'src/a.ts'), 'unstaged\n'); await writeFile(path.join(source, 'new.txt'), 'untracked\n');
  const beforeHead = await head(source); const beforeIndex = await git(source, ['diff', '--cached']);
  const workspace = await createWorkspace(source, path.join(root, 'mission'));
  assert.equal(await readFile(path.join(workspace.repo, 'src/a.ts'), 'utf8'), 'unstaged\n');
  assert.equal(await readFile(path.join(workspace.repo, 'new.txt'), 'utf8'), 'untracked\n');
  assert.equal(await head(source), beforeHead); assert.equal(await git(source, ['diff', '--cached']), beforeIndex);
});
test('dependent checkout starts from integrated checkpoint and delivery preserves unrelated changes', async t => {
  const { root, source } = await repo(t);
  const workspace = await createWorkspace(source, path.join(root, 'mission'));
  const first = await createCheckout(workspace, 'first', workspace.head);
  await writeFile(path.join(first, 'src/a.ts'), 'implemented a\n');
  const candidate = await checkpoint(first, 'first');
  const integration = await integrationCandidate(workspace, 'integrate-first', { cwd: first, base: workspace.head, candidate });
  const integrated = await checkpoint(integration, 'integrated'); await adopt(workspace, integration, integrated); workspace.head = integrated;
  const second = await createCheckout(workspace, 'second', workspace.head);
  assert.equal(await readFile(path.join(second, 'src/a.ts'), 'utf8'), 'implemented a\n');
  await writeFile(path.join(source, 'src/b.ts'), 'user edit\n');
  const beforeIndex = await git(source, ['diff', '--cached']);
  await deliver(workspace); await deliver(workspace);
  assert.equal(await readFile(path.join(source, 'src/a.ts'), 'utf8'), 'implemented a\n');
  assert.equal(await readFile(path.join(source, 'src/b.ts'), 'utf8'), 'user edit\n');
  assert.equal(await git(source, ['diff', '--cached']), beforeIndex);
});
test('out-of-scope patch and concurrent source modification fail closed', async t => {
  const { root, source } = await repo(t);
  const workspace = await createWorkspace(source, path.join(root, 'mission'));
  const lane = await createCheckout(workspace, 'lane', workspace.head);
  await writeFile(path.join(lane, 'outside.txt'), 'outside');
  const bad = await checkpoint(lane, 'bad');
  await assert.rejects(assertScope(lane, workspace.head, bad, resources, 'docs/tasks/record.md'), /outside approved scope/);
  await writeFile(path.join(workspace.repo, 'src/a.ts'), 'agent edit\n'); workspace.head = await checkpoint(workspace.repo, 'changed');
  await writeFile(path.join(source, 'src/a.ts'), 'concurrent edit\n');
  await assert.rejects(deliver(workspace), /conflicts/);
  assert.equal(await readFile(path.join(source, 'src/a.ts'), 'utf8'), 'concurrent edit\n');
});
test('writer path boundary rejects parent escape, symlink traversal, and read-only roles', async t => {
  const { root, source } = await repo(t);
  const contract = { cwd: source, role: 'writer', resources };
  await assert.rejects(writablePath(contract, '../outside'), /scope/);
  await symlink(root, path.join(source, 'src/link'));
  await assert.rejects(writablePath(contract, 'src/link/escaped'), /Symlink/);
  await assert.rejects(writablePath({ ...contract, role: 'reviewer' }, 'src/a.ts'), /scope/);
  assert.equal(await writablePath(contract, 'src/a.ts'), path.join(source, 'src/a.ts'));
});
test('durable check executes once across concurrent observers and records a real failure', async t => {
  const { root, source } = await repo(t);
  const counter = path.join(source, 'count');
  const command = { ...check, args: ['-e', 'require("fs").appendFileSync(process.argv[1],"x")', counter] };
  const signal = new AbortController().signal;
  const results = await Promise.all([durableCheck(command, source, path.join(root, 'evidence'), signal), durableCheck(command, source, path.join(root, 'evidence'), signal)]);
  assert.ok(results.every(result => result.code === 0)); assert.equal(await readFile(counter, 'utf8'), 'x');
  await durableCheck(command, source, path.join(root, 'evidence'), signal);
  assert.equal(await readFile(counter, 'utf8'), 'x');
  const failed = await durableCheck({ ...check, args: ['-e', 'process.exit(7)'] }, source, path.join(root, 'failure'), signal);
  assert.equal(failed.code, 7);
});
test('real ledger executes explicit work and delivers only the checked and reviewed revision', async t => {
  const { root, source } = await repo(t);
  const workspace = await createWorkspace(source, path.join(root, 'mission'));
  const h = await harness(t, { workspace }, {
    prepare: prepareAgent, collect: collectAgentResult, local: runLocal,
    deliver: (state, signal) => deliver(state.workspace, signal),
  });
  await h.engine.submitScope(brief, plan()); await h.engine.userAction('go', '1');
  await h.engine.submitWork([writeWork('change')]);
  await until(() => h.state.work.change.runId);
  await writeFile(path.join(h.state.work.change.cwd, 'src/a.ts'), 'implemented\n');
  await h.complete('change', writer);
  assert.equal(h.state.work.change.status, 'completed');
  await h.engine.submitWork([reviewWork('inspection', 'change', 'a'), checkWork('checks', 'change', 'a')]);
  await h.complete('inspection', review);
  await until(() => h.state.work.checks.status === 'completed');
  await h.engine.submitWork([integrateWork('merge', 'change', ['checks'], ['inspection'])]);
  await until(() => h.state.work.merge.status === 'completed', JSON.stringify(h.state.work.merge));
  assert.equal((await git(workspace.repo, ['status', '--porcelain'])).trim(), '');
  assert.equal(await readFile(path.join(source, 'src/a.ts'), 'utf8'), 'old\n');
  await h.engine.submitWork([checkWork('final-checks'), reviewWork('final-review', 'final-checks')]);
  await h.complete('final-review', review);
  await h.engine.requestDelivery({ checks: ['final-checks'], reviews: ['final-review'] });
  const beforeHead = await head(source);
  await h.engine.userAction('verify', '1');
  assert.equal(h.state.status, 'completed');
  assert.equal(await readFile(path.join(source, 'src/a.ts'), 'utf8'), 'implemented\n');
  assert.equal(await head(source), beforeHead);
});

test('input snapshot respects repository-local excludes and rejects recursive storage', async t => {
  const { root, source } = await repo(t);
  await writeFile(path.join(source, '.git/info/exclude'), 'private.txt\n');
  await writeFile(path.join(source, 'private.txt'), 'excluded');
  const workspace = await createWorkspace(source, path.join(root, 'mission'));
  await assert.rejects(readFile(path.join(workspace.repo, 'private.txt')), /ENOENT/);
  await assert.rejects(createWorkspace(source, path.join(source, 'mission')), /outside the source/);
});

test('final checks that modify source cannot alter the integration baseline', async t => {
  const { root, source } = await repo(t);
  const workspace = await createWorkspace(source, path.join(root, 'mission'));
  const value = plan(); value.finalChecks = [{ ...check, args: ['-e', 'require("fs").writeFileSync("src/a.ts","bad")'] }];
  const state = { workspace, plan: value };
  const job = { id: 'final', operationId: 'final', kind: 'check', revision: 1, dependsOn: [],
    snapshot: { cwd: workspace.repo, base: workspace.baseline, candidate: workspace.head, integratedHead: workspace.head, revision: 1 },
    receipt: path.join(root, 'final.json') };
  await assert.rejects(runLocal(state, job, new AbortController().signal), /changed source/);
  assert.equal(await readFile(path.join(workspace.repo, 'src/a.ts'), 'utf8'), 'old\n');
  assert.equal(await head(workspace.repo), workspace.head);
});
test('one mission admits only one live controller lease', async t => {
  const { root } = await repo(t);
  const { acquireMissionLease } = await import('../lib/complex-work/store.ts');
  const state = { workspace: { root } };
  const release = await acquireMissionLease(state);
  await assert.rejects(acquireMissionLease(state), /live controller/);
  await release();
  const next = await acquireMissionLease(state); await next();
});

test('durable supervisors enforce timeout and cancellation of command groups', async t => {
  const { root, source } = await repo(t);
  const slow = { ...check, timeoutMs: 1000, args: ['-e', 'setInterval(()=>{},100)'] };
  const timed = await durableCheck(slow, source, path.join(root, 'timeout'), new AbortController().signal);
  assert.equal(timed.timedOut, true); assert.notEqual(timed.code, 0);
  const controller = new AbortController();
  const pending = durableCheck({ ...slow, timeoutMs: 3000 }, source, path.join(root, 'cancel'), controller.signal);
  setTimeout(() => controller.abort(), 50);
  const cancelled = await pending;
  assert.equal(cancelled.cancelled, true); assert.notEqual(cancelled.code, 0);
});
