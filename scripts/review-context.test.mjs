import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { reviewContextParts } from './review-context.mjs'

test('ordered UTF-8 attachments reconstruct all evidence without byte or string truncation', () => {
  const input = {
    body: 'я🙂"\\\n'.repeat(17000),
    files: [{ filename: 'example.ts', patch: '+full patch' }]
  }
  const parts = reviewContextParts(input)
  assert.equal(parts.length, 3)
  for (const part of parts) {
    assert.ok(Buffer.byteLength(part) <= 90000)
    // Check round-trip through actual UTF-8, not only JavaScript surrogate pairs.
    assert.equal(Buffer.from(part).toString('utf8'), part)
  }
  assert.deepEqual(JSON.parse(parts.join('')), input)
  assert.equal(reviewContextParts({}).length, 1)
})

test('the total bound is applied before splitting, including JSON syntax overhead', () => {
  const exact = { body: 'x'.repeat(255989) }
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), 256000)
  assert.deepEqual(JSON.parse(reviewContextParts(exact).join('')), exact)
  assert.throws(() => reviewContextParts({ body: exact.body + 'x' }), /context too large/u)
  assert.throws(
    () => reviewContextParts({ body: 'я'.repeat(128000) }),
    /review context too large \(\d+ > 256000 bytes\); manual review required/u
  )
})

test('analysis attaches the full context once, keeps argv small and cleans up its files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'review-analysis-'))
  try {
    const output = join(temp, 'outputs')
    const capture = join(temp, 'capture.json')
    const executable = join(temp, 'review-cli.mjs')
    const input = { files: [], comments: [{ body: 'Полное обсуждение.\n'.repeat(4000) }] }
    writeFileSync(join(temp, 'review-input.json'), JSON.stringify(input))
    writeFileSync(output, '')
    writeFileSync(
      executable,
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args[0] === 'debug') {
  console.log(JSON.stringify([{
    id: 'pr-review', mode: 'primary', steps: 24,
    permissions: [{action: '*', resource: '*', effect: 'deny'},
                  {action: 'read', resource: '*', effect: 'allow'}]
  }]))
} else {
  const paths = args.flatMap((arg, index) => arg === '--file' ? [args[index + 1]] : [])
  const files = paths.map(path => readFileSync(path, 'utf8'))
  writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args, paths, files, token: process.env.GH_TOKEN}))
  console.log(JSON.stringify({type: 'step_start'}))
  console.log(JSON.stringify({type: 'text', part: {text: JSON.stringify({summary: 'Проверено.', findings: []})}}))
  console.log(JSON.stringify({type: 'step_finish', part: {reason: 'stop'}}))
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
        GH_TOKEN: 'must-not-reach-model'
      },
      encoding: 'utf8'
    })
    assert.equal(result.status, 0, result.stderr)
    const captured = JSON.parse(readFileSync(capture, 'utf8'))
    assert.ok(captured.files.length > 1)
    assert.deepEqual(JSON.parse(captured.files.join('')), input)
    assert.ok(captured.files.every((part) => Buffer.byteLength(part) <= 90000))
    assert.ok(Buffer.byteLength(captured.args.join(' ')) < 20000)
    assert.ok(captured.args.includes('opencode/deepseek-v4.1-flash-free'))
    assert.ok(captured.args.includes('--archived'))
    assert.equal(captured.token, undefined)
    assert.ok(captured.paths.every((path) => !existsSync(path)))
    assert.match(readFileSync(output, 'utf8'), /reason=success/u)
    assert.ok(!existsSync(join(temp, 'review-diagnostics.json')))
    const metrics = JSON.parse(readFileSync(join(temp, 'review-metrics.json'), 'utf8'))
    assert.deepEqual(metrics, {
      outcome: 'success',
      exitCode: 0,
      signal: null,
      stepsStarted: 1,
      stepsFinished: 1,
      finishReason: 'stop',
      malformedLines: 0
    })
    assert.match(result.stdout, /Review metrics: /u)
    assert.doesNotMatch(
      JSON.stringify(metrics),
      /Проверено|Полное обсуждение|must-not-reach-model/u
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
