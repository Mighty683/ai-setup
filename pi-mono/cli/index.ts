#!/usr/bin/env node

import { spawn, type ChildProcess } from 'node:child_process'

const WORKSPACE_CWD_ENV = 'PI_MONO_WORKSPACE_CWD'

function getRunner(): { command: string; args: string[] } {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return { command: process.execPath, args: [npmExecPath, 'run'] }
  }

  return { command: 'pnpm', args: ['run'] }
}

function runScript(
  scriptName: 'dev' | 'dev:backend',
  extraEnv: NodeJS.ProcessEnv = {}
): ChildProcess {
  const runner = getRunner()
  return spawn(runner.command, [...runner.args, scriptName], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv
    }
  })
}

let shuttingDown = false
const children: ChildProcess[] = []

function shutdown(exitCode = 0): void {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    }
  }, 2500).unref()

  process.exit(exitCode)
}

const backend = runScript('dev:backend', {
  [WORKSPACE_CWD_ENV]: process.cwd()
})
const frontend = runScript('dev')

children.push(backend, frontend)

backend.on('exit', (code, signal) => {
  if (!shuttingDown) {
    console.error(`Backend exited (${signal ?? code ?? 0}). Stopping frontend.`)
    shutdown(typeof code === 'number' ? code : 1)
  }
})

frontend.on('exit', (code, signal) => {
  if (!shuttingDown) {
    console.error(`Frontend exited (${signal ?? code ?? 0}). Stopping backend.`)
    shutdown(typeof code === 'number' ? code : 1)
  }
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
