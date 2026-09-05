import assert from 'node:assert/strict';
import test from 'node:test';
import { compileImplementationPlan, validateImplementationPlan, resourcesConflict, safePath, validateWorkBatch } from '../lib/complex-work-contracts.ts';
import { plan, task, markdown, readWork, writeWork } from './complex-work-fixtures.mjs';

test('scope rejects duplicate tasks and unassigned criteria', () => {
  assert.match(validateImplementationPlan(plan([task('a'), task('a')])).errors.join('\n'), /Duplicate task/);
  const value = plan(); value.acceptanceCriteria.push({ id: 'missing', description: 'Unassigned' });
  assert.match(validateImplementationPlan(value).errors.join('\n'), /Unassigned/);
});
test('work graph rejects cycles, unknown dependencies and undeclared input dependencies', () => {
  assert.match(validateWorkBatch([readWork('a', ['b']), readWork('b', ['a'])], []).errors.join('\n'), /cycle/);
  assert.match(validateWorkBatch([readWork('a', ['missing'])], []).errors.join('\n'), /unknown dependency/);
  assert.match(validateWorkBatch([readWork('a'), { ...readWork('b'), input: 'a' }], []).errors.join('\n'), /direct dependency/);
  assert.match(validateWorkBatch([{ ...readWork('a'), allowFailed: ['missing'] }], []).errors.join('\n'), /must be a dependency/);
});
test('final invalid JSON never falls back to an earlier valid plan', () => {
  assert.equal(compileImplementationPlan(markdown(plan()) + '\n```json\n{invalid}\n```').ok, false);
  assert.equal(compileImplementationPlan(markdown(plan())).ok, true);
});
test('resource conflicts include directory containment and read/write contracts', () => {
  const resource = (kind, name, access = 'write') => ({ kind, name, access });
  assert.equal(resourcesConflict(resource('directory', 'src'), resource('file', 'src/file.ts')), true);
  assert.equal(resourcesConflict(resource('directory', 'src'), resource('file', 'src-other/file.ts')), false);
  assert.equal(resourcesConflict(resource('file', 'src/file.ts', 'read'), resource('file', 'src/file.ts', 'read')), false);
  assert.equal(resourcesConflict(resource('contract', 'API'), resource('contract', 'API', 'read')), true);
});
test('unsafe paths, empty checks and unknown criteria are rejected', () => {
  for (const file of ['/tmp/file', '../file', 'src/../file', 'src//file', 'src\\file', 'C:/file', '.git/config', '.pi/file', 'src/*']) assert.equal(safePath(file), false, file);
  const value = plan(); value.tasks[0].checks = [];
  assert.equal(validateImplementationPlan(value).ok, false);
  value.tasks[0] = task('a'); value.tasks[0].criteria = ['unknown'];
  assert.match(validateImplementationPlan(value).errors.join('\n'), /unknown criterion/);
});
test('agent work requires instructions and write authority is tied to a scope task', () => {
  const missing = readWork('a'); delete missing.assignment;
  assert.equal(validateWorkBatch([missing], []).ok, false);
  const empty = readWork('a'); empty.assignment.instructions = '  ';
  assert.equal(validateWorkBatch([empty], []).ok, false);
  const unauthorized = writeWork('a'); delete unauthorized.taskId;
  assert.match(validateWorkBatch([unauthorized], []).errors.join('\n'), /approved taskId/);
  assert.equal(validateWorkBatch([readWork('constructor')], []).ok, false);
});
