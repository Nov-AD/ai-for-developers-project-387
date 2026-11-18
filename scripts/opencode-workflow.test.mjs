import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/opencode.yml', import.meta.url), 'utf8')
const runStep = workflow.split('      - name: Run OpenCode\n')[1]

test('manual agent shell receives an Issues-write token without changing App authentication', () => {
  assert.match(
    workflow,
    /permissions:\n\s+contents: read\n\s+issues: write\n\s+pull-requests: read/
  )
  assert.match(runStep, /env:\n(?:\s+#[^\n]*\n)*\s+GH_TOKEN: \$\{\{ github\.token }}/)
  assert.match(runStep, /GH_REPO: \$\{\{ github\.repository }}/)
  assert.match(runStep, /GH_PROMPT_DISABLED: "1"/)
  assert.doesNotMatch(runStep, /use_github_token: true/)
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|secrets\./)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /is_fork.*!= "false"/)
})

test('GitHub Action receives a V1 policy that rejects approvals without V2-only fields', () => {
  const content = runStep.match(/OPENCODE_CONFIG_CONTENT: >-\n((?: {12}.*\n)+)/)?.[1]
  assert.ok(content, 'Run OpenCode must receive an inline CI policy')
  const config = JSON.parse(content)
  assert.equal(config.permissions, undefined, 'The GitHub Action installs V1, not V2')
  assert.deepEqual(config.permission, {
    external_directory: 'deny',
    read: { '*.env': 'deny', '*.env.*': 'deny' }
  })
})
