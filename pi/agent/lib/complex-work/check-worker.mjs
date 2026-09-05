// Detached check supervisor: survives controller restarts, owns timeout/cancel, records real exits.
import { readFile, writeFile, rename, open, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const configFile = process.argv[2];
const config = JSON.parse(await readFile(configFile, 'utf8'));
const { resultFile, lockFile, cancelFile, cwd, check } = config;
await mkdir(path.dirname(lockFile), { recursive: true });
let lock;
try { lock = await open(lockFile, 'wx', 0o600); }
catch (error) { if (error.code === 'EEXIST') process.exit(0); throw error; }
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
await lock.close();
const startedAt = new Date().toISOString();
let child;
let stdout = ''; let stderr = ''; let timedOut = false; let cancelled = false;
const stop = () => {
  try { if (process.platform === 'win32') child?.kill('SIGKILL'); else if (child?.pid) process.kill(-child.pid, 'SIGKILL'); }
  catch { /* It may already have exited. */ }
};
const timer = setTimeout(() => { timedOut = true; stop(); }, check.timeoutMs);
const cancellation = setInterval(async () => {
  try { await readFile(cancelFile); cancelled = true; stop(); } catch {}
}, 100);
let code = -1;
try {
  code = await new Promise(resolve => {
    child = spawn(check.command, check.args, { cwd, env: { ...process.env, CARGO_TARGET_DIR: path.join(cwd, 'target') },
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-1_048_576); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-1_048_576); });
    child.once('error', error => { stderr += String(error); resolve(-1); });
    child.once('close', exit => resolve(exit ?? -1));
  });
} finally {
  clearTimeout(timer); clearInterval(cancellation);
  const result = { check, cwd, code, stdout, stderr, timedOut, cancelled, startedAt, endedAt: new Date().toISOString() };
  await writeFile(resultFile + '.tmp', JSON.stringify(result), { mode: 0o600 });
  await rename(resultFile + '.tmp', resultFile);
}
