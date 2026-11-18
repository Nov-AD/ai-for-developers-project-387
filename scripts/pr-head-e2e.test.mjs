import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('independent E2E uses exact author SHA, isolated real app and archives successful traces', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/pr-head-e2e.yml', import.meta.url),
    'utf8'
  )
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha }}/)
  assert.match(workflow, /actual_sha="\$\(git rev-parse HEAD\)"/)
  assert.match(workflow, /test "\$actual_sha" = "\$EXPECTED_SHA"/)
  assert.match(workflow, /PLAYWRIGHT_TRACE: "on"/)
  assert.match(workflow, /mise run test:e2e/)
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/)
  assert.match(workflow, /if: always\(\)/)
  assert.match(workflow, /apps\/web\/test-results\//)
  assert.match(workflow, /Outcome:/)
  assert.doesNotMatch(workflow, /secrets\.|id-token:|pull_request_target|: write|MODEL:/)
  const config = readFileSync(new URL('../apps/web/playwright.config.ts', import.meta.url), 'utf8')
  assert.match(config, /PLAYWRIGHT_TRACE === 'on' \? 'on'/)
  assert.match(config, /reuseExistingServer: false/)
})
