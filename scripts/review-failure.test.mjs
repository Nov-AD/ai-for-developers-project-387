import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

function analyze(events, status = 0) {
  const temp = mkdtempSync(join(tmpdir(), 'review-failure-'))
  try {
    const output = join(temp, 'outputs')
    const executable = join(temp, 'review-cli.mjs')
    writeFileSync(join(temp, 'review-input.json'), JSON.stringify({ files: [] }))
    writeFileSync(output, '')
    writeFileSync(
      executable,
      `#!/usr/bin/env node
if (process.env.GH_TOKEN) throw new Error('GitHub token reached model')
if (process.argv[2] === 'debug') {
  console.log(JSON.stringify([{
    id: 'pr-review', mode: 'primary', steps: 24,
    permissions: [{action: '*', resource: '*', effect: 'deny'},
                  {action: 'read', resource: '*', effect: 'allow'}]
  }]))
} else {
  process.stderr.write('private-stderr-value')
  process.stdout.write(${JSON.stringify(typeof events === 'string' ? events : events.map((entry) => JSON.stringify(entry)).join('\n'))})
  process.exitCode = ${status}
}
`
    )
    chmodSync(executable, 0o755)
    const result = spawnSync(process.execPath, ['scripts/pr-review.mjs', 'analyze'], {
      env: {
        ...process.env,
        RUNNER_TEMP: temp,
        GITHUB_OUTPUT: output,
        REVIEW_CLI: executable,
        REVIEW_CRITERIA: 'REVIEW.md',
        GH_TOKEN: 'credential-from-environment'
      },
      encoding: 'utf8'
    })
    const outputs = readFileSync(output, 'utf8')
    const diagnosticPath = join(temp, 'review-diagnostics.json')
    const diagnosticText = existsSync(diagnosticPath) ? readFileSync(diagnosticPath, 'utf8') : null
    const metricsPath = join(temp, 'review-metrics.json')
    const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, 'utf8')) : null
    return {
      result,
      outputs,
      diagnosticText,
      diagnostic: diagnosticText && JSON.parse(diagnosticText),
      metrics
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

test('analyze fails closed with a redacted diagnostic instead of publishing plain model text', () => {
  const events = [
    { type: 'step_start', part: { messageID: 'final' } },
    { type: 'tool_use', part: { input: 'private-tool-input', output: 'private-tool-result' } },
    {
      type: 'text',
      part: {
        messageID: 'final',
        text: [
          'Максимальное число шагов.',
          'credential-from-environment',
          'Authorization: Bearer private-bearer-value',
          'password=private-password-value',
          'ghp_' + '123456789012345678901234567890123456',
          'sk-' + '123456789012345678901234567890123456',
          ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjMifQ', 'c2lnbmF0dXJl'].join('.'),
          'https://user:private-url-password@example.com/?token=private-query-value',
          ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
          'private-key-material',
          ['-----END', 'PRIVATE KEY-----'].join(' ')
        ].join('\n')
      }
    },
    { type: 'step_finish', part: { reason: 'stop', messageID: 'final' } }
  ]
  const { result, outputs, diagnosticText, diagnostic, metrics } = analyze(events)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Ревью не завершено: модель не вернула JSON по схеме ревью/u)
  assert.match(outputs, /reason=agent_failed/u)
  assert.match(outputs, /review_failure=invalid_response/u)
  assert.doesNotMatch(outputs, /proposal=|reason=success/u)
  assert.equal(diagnostic.failure, 'invalid_response')
  assert.equal(diagnostic.exitCode, 0)
  assert.equal(diagnostic.stepsStarted, 1)
  assert.equal(diagnostic.stepsFinished, 1)
  assert.equal(diagnostic.finishReason, 'stop')
  assert.match(diagnostic.response, /^Максимальное число шагов\./u)
  assert.match(diagnostic.response, /<REDACTED>/u)
  assert.deepEqual(metrics, {
    outcome: 'invalid_response',
    exitCode: 0,
    signal: null,
    stepsStarted: 1,
    stepsFinished: 1,
    finishReason: 'stop',
    malformedLines: 0
  })
  assert.doesNotMatch(
    diagnosticText + result.stderr + result.stdout + outputs,
    /credential-from-environment|private-|ghp_123|sk-123|eyJhbGci|BEGIN PRIVATE KEY/u
  )
})

test('analyze preserves completion evidence for cut-off streams, model errors and process failures', () => {
  const text = { type: 'text', part: { text: '{"summary":"Проверено.","findings":[]}' } }
  const finish = { type: 'step_finish', part: { reason: 'stop' } }
  for (const [events, status, failure, finishReason, malformedLines] of [
    [[text], 0, 'incomplete_response', 'unavailable', 0],
    [[text, { ...finish, part: { reason: 'length' } }], 0, 'incomplete_response', 'length', 0],
    [
      [text, { ...finish, part: { reason: 'private-fake-reason' } }],
      0,
      'incomplete_response',
      'unavailable',
      0
    ],
    [JSON.stringify(text) + '\n{"type":', 0, 'invalid_stream', 'unavailable', 1],
    [
      [text, finish, { type: 'error', error: 'private-model-error' }],
      0,
      'runtime_error',
      'stop',
      0
    ],
    [[text, finish], 1, 'agent_failed', 'stop', 0]
  ]) {
    const { result, outputs, diagnosticText, diagnostic, metrics } = analyze(events, status)
    assert.equal(result.status, 1)
    assert.doesNotMatch(outputs, /proposal=|reason=success/u)
    assert.match(outputs, /reason=agent_failed/u)
    assert.equal(diagnostic.failure, failure)
    assert.equal(diagnostic.finishReason, finishReason)
    assert.equal(diagnostic.malformedLines, malformedLines)
    assert.equal(metrics.outcome, failure)
    assert.equal(metrics.finishReason, finishReason)
    assert.equal(metrics.malformedLines, malformedLines)
    assert.doesNotMatch(diagnosticText + result.stderr, /private-/u)
  }
})

test('step-limit finalization accepts only strict JSON and records all 24 steps', () => {
  const prior = Array.from({ length: 23 }, (_, index) => [
    { type: 'step_start', part: { messageID: `research-${index}` } },
    { type: 'tool_use', part: { input: 'private-tool-input', output: 'private-tool-result' } },
    { type: 'step_finish', part: { reason: 'tool-calls', messageID: `research-${index}` } }
  ]).flat()
  const proposal = JSON.stringify({
    summary:
      'Лимит исследования исчерпан; соседние сценарии не проверены. Нужна проверка человеком.',
    findings: []
  })
  for (const [text, success] of [
    [proposal, true],
    ['Достигнут лимит шагов.\n\n' + proposal, false],
    ['<｜DSML｜ calls><｜DSML｜ invoke name="grep"></｜DSML｜ invoke></｜DSML｜ calls>', false]
  ]) {
    const { result, outputs, diagnostic, metrics } = analyze([
      ...prior,
      { type: 'step_start', part: { messageID: 'final' } },
      { type: 'text', part: { messageID: 'final', text } },
      { type: 'step_finish', part: { messageID: 'final', reason: 'stop' } }
    ])
    assert.equal(result.status, success ? 0 : 1, result.stderr)
    assert.equal(metrics.stepsStarted, 24)
    assert.equal(metrics.stepsFinished, 24)
    assert.equal(metrics.finishReason, 'stop')
    assert.equal(metrics.outcome, success ? 'success' : 'invalid_response')
    if (success) {
      assert.match(outputs, /reason=success/u)
      assert.ok(outputs.includes(`proposal=${proposal}`))
      assert.equal(diagnostic, null)
    } else {
      assert.doesNotMatch(outputs, /proposal=|reason=success/u)
      assert.equal(diagnostic.failure, 'invalid_response')
    }
    assert.doesNotMatch(result.stdout + JSON.stringify(metrics), /private-|DSML|соседние сценарии/u)
  }
})

test('diagnostic responses are bounded after redaction, not in the middle of a credential', () => {
  const { diagnostic, diagnosticText } = analyze([
    {
      type: 'text',
      part: { text: 'я'.repeat(7990) + 'credential-from-environment' + 'я'.repeat(100) }
    },
    { type: 'step_finish', part: { reason: 'stop' } }
  ])
  assert.equal(diagnostic.response.length, 8000)
  assert.equal(diagnostic.responseTruncated, true)
  assert.doesNotMatch(diagnosticText, /credential/u)
})
