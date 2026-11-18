import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function agentFailureReason(timedOut, error, status, text, started) {
  if (timedOut) return 'timeout'
  if (error) return 'infra'
  if (status === 0) return 'success'
  if (
    started === false ||
    /(?:missing|no|invalid|not found).{0,35}api.?key|api.?key.{0,35}(?:missing|required|not found)|ProviderModelNotFoundError/iu.test(
      text
    )
  ) {
    return 'infra'
  }
  return 'agent_failed'
}

export function runManualAgent(executable, { timeout = 18 * 60 * 1000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...env }
    // The model must not append fake step outputs; only this supervising process reports.
    for (const key of ['GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH']) delete childEnv[key]
    const child = spawn(executable, ['github', 'run'], { env: childEnv, detached: true })
    let timedOut = false
    let error
    let tail = ''
    let started = false
    let killTimer
    const kill = (signal) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal)
        } catch (failure) {
          if (failure.code !== 'ESRCH') throw failure
        }
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 5000)
    }, timeout)
    for (const [stream, target] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr]
    ]) {
      stream.on('data', (chunk) => {
        target.write(chunk)
        tail = (tail + chunk).slice(-16000)
        started ||= tail.includes('Sending message to opencode...')
      })
    }
    child.on('error', (failure) => {
      error = failure
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      resolve(agentFailureReason(timedOut, error, status, tail, started))
    })
  })
}

async function main() {
  assert.ok(process.env.MANUAL_AGENT_CLI, 'MANUAL_AGENT_CLI required')
  const reason = await runManualAgent(process.env.MANUAL_AGENT_CLI)
  appendFileSync(process.env.GITHUB_OUTPUT, `reason=${reason}\n`)
  if (reason !== 'success') process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
