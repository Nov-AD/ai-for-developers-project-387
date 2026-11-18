import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const workflow = readFileSync(
  process.env.WORKFLOW_POLICY_ROOT
    ? resolve(process.env.WORKFLOW_POLICY_ROOT, '.github/workflows/opencode.yml')
    : new URL('../.github/workflows/opencode.yml', import.meta.url),
  'utf8'
)
const worker = workflow.split('\n  opencode:')[1]?.split('\n  report:')[0] ?? ''
const runStep = worker.split('      - name: Run OpenCode\n')[1] ?? ''

test('model execution requires successful persistent budget admission first', () => {
  assert.match(worker, /needs: admit/, 'missing budget dependency before model execution')
  assert.match(
    worker,
    /if: needs\.admit\.outputs\.allowed == 'true'/,
    'model must be skipped when the persistent budget denies admission'
  )
  assert.match(workflow, /node scripts\/agent-budget\.mjs admit/)
  assert.match(workflow, /oc-budget-v1:pr:/)
})

test('Re-run failed jobs cannot reuse a stale successful admission to call the model', () => {
  assert.match(worker, /id: budget/, 'worker must independently recheck this run_attempt')
  assert.match(
    worker,
    /node scripts\/agent-budget\.mjs admit/,
    'a rerun of only the worker must query Actions history again'
  )
  assert.match(
    runStep,
    /if: steps\.budget\.outputs\.allowed == 'true'/,
    'the model step must use the current attempt, not an old job output'
  )
})

test('manual agent keeps Issues-write shell token, App OIDC, and Actions history read only', () => {
  assert.match(worker, /issues: write/)
  assert.match(worker, /pull-requests: read/)
  assert.match(worker, /actions: read/)
  assert.match(runStep, /GH_TOKEN: \$\{\{ github\.token }}/)
  assert.match(runStep, /GH_REPO: \$\{\{ github\.repository }}/)
  assert.match(runStep, /USE_GITHUB_TOKEN: "false"/)
  assert.doesNotMatch(worker, /contents: write|pull-requests: write|actions: write|secrets\./)
  assert.match(worker, /id-token: write/)
  assert.match(worker, /persist-credentials: false/)
  assert.match(worker, /npm ci --prefix \.github\/manual-agent/)
})

test('locked V1 GitHub integration receives its native denial policy', () => {
  const content = runStep.match(/OPENCODE_CONFIG_CONTENT: >-\n((?: {12}.*\n)+)/)?.[1]
  assert.ok(content)
  const config = JSON.parse(content)
  assert.equal(config.permissions, undefined)
  assert.deepEqual(config.permission, {
    external_directory: 'deny',
    read: { '*.env': 'deny', '*.env.*': 'deny' }
  })
  const tools = JSON.parse(
    readFileSync(new URL('../.github/manual-agent/package.json', import.meta.url), 'utf8')
  )
  assert.equal(tools.dependencies['opencode-ai'], '1.19.6')
})

test('failure report runs independently without model or OIDC and with time after worker stops', () => {
  const report = workflow.split('\n  report:')[1]
  assert.ok(report)
  assert.match(report, /always\(\)/)
  assert.match(report, /pull-requests: write/)
  assert.match(report, /node scripts\/agent-budget\.mjs report/)
  assert.doesNotMatch(report, /id-token:|MANUAL_AGENT_CLI|npm ci|MODEL:/)
  assert.match(runStep, /timeout-minutes: 20/)
  assert.match(worker, /timeout-minutes: 30/)
})
