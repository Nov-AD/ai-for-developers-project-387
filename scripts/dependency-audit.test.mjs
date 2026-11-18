import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  auditFromEvents,
  normalizeReport,
  parseAuditProposal,
  publishAudit,
  renderFinding,
  validateAuditPolicy
} from './dependency-audit.mjs'
import { modelEnvironment } from './auto-triage.mjs'

function report(overrides = {}) {
  return {
    results: [
      {
        source: { path: 'pnpm-lock.yaml' },
        packages: [
          {
            package: { ecosystem: 'npm', name: 'example', version: '1.0.0' },
            vulnerabilities: [
              {
                id: 'GHSA-aaaa-bbbb-cccc',
                aliases: ['CVE-2026-12345'],
                summary: 'Example vulnerability',
                affected: [
                  {
                    package: { ecosystem: 'npm', name: 'example' },
                    ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.0.1' }] }]
                  }
                ],
                ...overrides
              }
            ]
          }
        ]
      }
    ]
  }
}

function proposal(input) {
  return JSON.stringify({
    summary: 'Оценка по отчёту; эксплуатируемость не проверена.',
    findings: input.findings.map(({ key }) => ({
      key,
      analysis: 'Требуется проверка зависимости.',
      recommendation: 'Проверить обновление и запустить тесты.'
    }))
  })
}

const run = { sha: 'a'.repeat(40), url: 'https://github.com/owner/repo/actions/runs/1' }

test('normalizes OSV aliases, affected versions, locations and fixed versions', () => {
  const input = normalizeReport(report())
  assert.equal(input.findings.length, 1)
  const finding = input.findings[0]
  assert.equal(finding.id, 'CVE-2026-12345')
  assert.deepEqual(finding.fixed, ['1.0.1'])
  assert.deepEqual(finding.locations, ['pnpm-lock.yaml: 1.0.0'])
  assert.match(finding.key, /^[a-f0-9]{64}$/u)
})

test('repeated package/advisory across lockfiles and versions stays one finding', () => {
  const raw = report()
  const other = structuredClone(raw.results[0])
  other.source.path = '.github/auto-triage/package-lock.json'
  other.packages[0].package.version = '0.9.0'
  raw.results.push(other)
  const input = normalizeReport(raw)
  assert.equal(input.findings.length, 1)
  assert.equal(input.findings[0].key, normalizeReport(report()).findings[0].key)
  assert.equal(input.findings[0].locations.length, 2)
})

test('different packages or advisories get independent keys', () => {
  const base = normalizeReport(report()).findings[0].key
  const raw = report()
  raw.results[0].packages[0].package.name = 'different-package'
  assert.notEqual(normalizeReport(raw).findings[0].key, base)
  assert.notEqual(normalizeReport(report({ id: 'OTHER', aliases: [] })).findings[0].key, base)
})

test('clean report is empty; training is explicit, stable and only used on a clean scan', () => {
  assert.deepEqual(normalizeReport({ results: [] }), { findings: [] })
  const training = normalizeReport({ results: [] }, true)
  assert.equal(training.findings.length, 1)
  assert.equal(training.findings[0].source, 'training')
  assert.match(training.findings[0].summary, /Учебная задача/u)
  assert.deepEqual(training, normalizeReport({ results: [] }, true))
  assert.deepEqual(normalizeReport(report(), true), normalizeReport(report()))
})

test('malformed or oversized OSV report fails rather than reporting no findings', () => {
  assert.throws(() => normalizeReport({}), /missing OSV results/u)
  assert.throws(() => normalizeReport({ results: [{}] }), /packages/u)
  assert.throws(() => normalizeReport(report({ id: '' })), /OSV id/u)
  assert.throws(() => normalizeReport(report({ summary: 'x'.repeat(80001) })), /too large/u)
})

test('model must account for every finding exactly once and cannot invent a finding', () => {
  const input = normalizeReport(report())
  const valid = JSON.parse(proposal(input))
  assert.deepEqual(parseAuditProposal(JSON.stringify(valid), input), valid)
  assert.throws(() => parseAuditProposal(proposal({ findings: [] }), input), /every finding/u)
  assert.throws(() => parseAuditProposal(proposal(input), { findings: [] }), /every finding/u)
  valid.findings.push(valid.findings[0])
  assert.throws(() => parseAuditProposal(JSON.stringify(valid), input), /every finding/u)
})

test('model text and schema are bounded; markdown code fences are not silently accepted', () => {
  const input = normalizeReport(report())
  for (const change of [
    (value) => {
      value.summary = ''
    },
    (value) => {
      value.summary = 'x'.repeat(3001)
    },
    (value) => {
      value.findings[0].analysis = 'one\ntwo'
    },
    (value) => {
      value.extra = 'unexpected'
    },
    (value) => {
      value.findings[0].url = 'https://example.com'
    }
  ]) {
    const value = JSON.parse(proposal(input))
    change(value)
    assert.throws(() => parseAuditProposal(JSON.stringify(value), input))
  }
  assert.throws(() => parseAuditProposal('```json\n{}\n```', input))
})

test('agent errors or missing final text do not become clean reports', () => {
  const input = normalizeReport(report())
  const output = JSON.stringify({ type: 'text', part: { text: proposal(input) } })
  assert.deepEqual(auditFromEvents(output, input), JSON.parse(proposal(input)))
  assert.throws(() => auditFromEvents(output + '\n{"type":"error"}', input), /model reported/u)
  assert.throws(() => auditFromEvents('{"type":"finish"}', input), /invalid agent output/u)
})

test('effective policy requires a bounded primary agent with all tools denied', () => {
  const agent = {
    id: 'dependency-audit',
    mode: 'primary',
    steps: 4,
    permissions: [{ action: '*', resource: '*', effect: 'deny' }]
  }
  validateAuditPolicy([agent])
  for (const change of [
    { steps: 100 },
    { mode: 'subagent' },
    { permissions: [] },
    { permissions: [...agent.permissions, { action: 'shell', resource: '*', effect: 'allow' }] },
    { permissions: [...agent.permissions, { action: 'read', resource: '*', effect: 'ask' }] }
  ]) {
    assert.throws(() => validateAuditPolicy([{ ...agent, ...change }]))
  }
  assert.throws(() => validateAuditPolicy([]))
})

test('model environment excludes credentials and ambient OpenCode config', () => {
  const env = modelEnvironment('/bin', '/isolated-home')
  assert.equal(env.HOME, '/isolated-home')
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENCODE_CONFIG_CONTENT', 'OPENAI_API_KEY']) {
    assert.equal(Object.hasOwn(env, key), false)
  }
})

test('issue body labels training honestly and escapes evidence and model mentions', () => {
  const input = normalizeReport({ results: [] }, true)
  const finding = { ...input.findings[0], name: '@someone/<unsafe>' }
  const analysis = { analysis: '@all *risk*', recommendation: '[click](https://example.com)' }
  const body = renderFinding(finding, analysis, run)
  assert.match(body, /Учебная задача/u)
  assert.match(body, /не реальная уязвимость/u)
  assert.ok(!body.includes('@all'))
  assert.ok(!body.includes('<unsafe>'))
  assert.ok(body.includes(run.url))
})

function fakeApi(initial = []) {
  const issues = structuredClone(initial)
  const calls = []
  const api = async (method, route, body) => {
    calls.push({ method, route, body })
    if (method === 'GET') {
      assert.match(route, /state=all/u)
      const page = Number(new URL(`https://example.test/${route}`).searchParams.get('page'))
      return issues.slice((page - 1) * 100, page * 100)
    }
    assert.equal(method, 'POST')
    assert.equal(route, 'repos/owner/repo/issues')
    const issue = {
      ...body,
      number: issues.length + 1,
      html_url: `https://github.com/owner/repo/issues/${issues.length + 1}`,
      user: { login: 'github-actions[bot]', type: 'Bot' }
    }
    issues.push(issue)
    return issue
  }
  return { api, calls, issues }
}

test('publisher creates an issue automatically, then reuses the same issue on rerun', async () => {
  const input = normalizeReport(report())
  const { api, calls, issues } = fakeApi()
  const first = await publishAudit(api, 'owner/repo', input, proposal(input), run)
  assert.equal(first[0].action, 'created')
  assert.match(issues[0].title, /^\[audit\]/u)
  issues[0].state = 'closed'
  const second = await publishAudit(api, 'owner/repo', input, proposal(input), run)
  assert.equal(second[0].action, 'reused')
  assert.equal(second[0].url, first[0].url)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
})

test('training issue uses the same automatic publisher and is deduplicated', async () => {
  const input = normalizeReport({ results: [] }, true)
  const { api, issues } = fakeApi()
  await publishAudit(api, 'owner/repo', input, proposal(input), run)
  const second = await publishAudit(api, 'owner/repo', input, proposal(input), run)
  assert.match(issues[0].title, /^\[Учебная задача\]/u)
  assert.match(issues[0].body, /не реальная уязвимость/u)
  assert.equal(second[0].action, 'reused')
  assert.equal(issues.length, 1)
})

test('deduplication paginates all issues, including closed ones', async () => {
  const input = normalizeReport(report())
  const { api, issues, calls } = fakeApi(
    Array.from({ length: 100 }, (_, index) => ({ number: index + 1, body: 'unrelated' }))
  )
  await publishAudit(api, 'owner/repo', input, proposal(input), run)
  const second = await publishAudit(api, 'owner/repo', input, proposal(input), run)
  assert.equal(second[0].action, 'reused')
  assert.equal(issues.length, 101)
  assert.ok(calls.some((call) => call.route.endsWith('page=2')))
})

test('clean scan creates no issue and an invalid proposal never reaches the API', async () => {
  const { api, calls } = fakeApi()
  const empty = { findings: [] }
  assert.deepEqual(await publishAudit(api, 'owner/repo', empty, proposal(empty), run), [])
  const input = normalizeReport(report())
  await assert.rejects(publishAudit(api, 'owner/repo', input, proposal(empty), run))
  assert.equal(calls.length, 0)
})

test('publisher fails on API errors; partial successful creation is safe to retry', async () => {
  const raw = report()
  const other = structuredClone(raw.results[0].packages[0])
  other.package.name = 'other'
  raw.results[0].packages.push(other)
  const input = normalizeReport(raw)
  const { api, issues } = fakeApi()
  let posts = 0
  const failing = async (method, route, body) => {
    if (method === 'POST' && ++posts === 2) throw new Error('API unavailable')
    return api(method, route, body)
  }
  await assert.rejects(
    publishAudit(failing, 'owner/repo', input, proposal(input), run),
    /API unavailable/u
  )
  assert.equal(issues.length, 1)
  const retry = await publishAudit(api, 'owner/repo', input, proposal(input), run)
  assert.deepEqual(retry.map((result) => result.action).sort(), ['created', 'reused'])
  assert.equal(issues.length, 2)
})

function pipelineFixture(t, scannerReport = { results: [] }, scannerStatus = 0) {
  const temp = mkdtempSync(join(tmpdir(), 'dependency-audit-test-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const bin = join(temp, 'bin')
  mkdirSync(bin)
  const executable = (name, code) => {
    const path = join(bin, name)
    writeFileSync(path, `#!${process.execPath}\n${code}`)
    chmodSync(path, 0o755)
    return path
  }
  executable(
    'mise',
    `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    if (JSON.stringify(args.slice(0, 5)) !== JSON.stringify(['run', 'audit', '--', '--format', 'json'])) process.exit(99);
    fs.writeFileSync(args[args.indexOf('--output-file') + 1], ${JSON.stringify(JSON.stringify(scannerReport))});
    process.exit(${scannerStatus});
  `
  )
  const cli = executable(
    'opencode',
    `
    if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.OPENCODE_CONFIG_CONTENT) process.exit(99);
    if (process.argv[2] === 'debug') {
      console.log(JSON.stringify([{id: 'dependency-audit', mode: 'primary', steps: 4,
        permissions: [{action: '*', resource: '*', effect: 'deny'}]}]));
    } else {
      const modelIndex = process.argv.indexOf('--model');
      if (modelIndex === -1 || process.argv[modelIndex + 1] !== 'opencode/deepseek-v4.1-flash-free') process.exit(99);
      const prompt = process.argv.at(-1);
      const input = JSON.parse(prompt.slice(prompt.indexOf('\\n') + 1));
      console.log(JSON.stringify({type: 'text', part: {text: JSON.stringify({
        summary: 'Учебный анализ тестового отчёта.',
        findings: input.findings.map(({key}) => ({key, analysis: 'Учебная задача.',
          recommendation: 'Проверить демонстрационный сценарий.'}))
      })}}));
    }
  `
  )
  const issuesFile = join(temp, 'issues.json')
  writeFileSync(issuesFile, '[]')
  executable(
    'gh',
    `
    const fs = require('node:fs');
    const file = ${JSON.stringify(issuesFile)};
    const issues = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (process.argv[4] === 'GET') console.log(JSON.stringify(issues));
    else {
      const issue = {...JSON.parse(fs.readFileSync(0, 'utf8')), number: issues.length + 1,
        html_url: 'https://github.com/owner/repo/issues/' + (issues.length + 1),
        user: {login: 'github-actions[bot]', type: 'Bot'}};
      issues.push(issue);
      fs.writeFileSync(file, JSON.stringify(issues));
      console.log(JSON.stringify(issue));
    }
  `
  )
  const event = join(temp, 'event.json')
  writeFileSync(event, JSON.stringify({ repository: { default_branch: 'main' } }))
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  const directory = join(temp, 'report')
  const execute = (mode, overrides = {}) =>
    spawnSync(process.execPath, [resolve('scripts/dependency-audit.mjs'), mode], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: temp,
        AUDIT_DIR: directory,
        AUDIT_CLI: cli,
        AUDIT_TRAINING: 'true',
        GH_TOKEN: 'test-only-token',
        GITHUB_TOKEN: 'test-only-token',
        OPENCODE_CONFIG_CONTENT: '{"untrusted":"ambient config must not reach model"}',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_SHA: sha,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_EVENT_PATH: event,
        GITHUB_RUN_ID: '1',
        GITHUB_RUN_ATTEMPT: '1',
        ...overrides
      }
    })
  return {
    execute,
    directory,
    issuesFile,
    read: (name) => JSON.parse(readFileSync(join(directory, name), 'utf8'))
  }
}

test('full pipeline saves evidence outside checkout and automatically deduplicates training issue with fake tools', (t) => {
  const fixture = pipelineFixture(t)
  for (const action of ['created', 'reused']) {
    for (const mode of ['scan', 'analyze', 'publish']) {
      const result = fixture.execute(mode)
      assert.equal(result.status, 0, result.stderr)
    }
    assert.equal(fixture.read('publication.json')[0].action, action)
  }
  assert.equal(JSON.parse(readFileSync(fixture.issuesFile, 'utf8')).length, 1)
  for (const file of [
    'osv.json',
    'scanner.log',
    'prompt.txt',
    'agent-output.jsonl',
    'agent-policy.log',
    'report.md'
  ]) {
    assert.ok(existsSync(join(fixture.directory, file)), file)
  }
  assert.ok(!existsSync(join(fixture.directory, 'agent-home')))
  assert.match(readFileSync(join(fixture.directory, 'report.md'), 'utf8'), /Статус: success/u)
})

test('scanner finding exit code is accepted and reaches analysis, without a training finding', (t) => {
  const fixture = pipelineFixture(t, report(), 1)
  assert.equal(fixture.execute('scan').status, 0)
  assert.equal(fixture.read('input.json').findings[0].source, 'osv')
  assert.equal(fixture.execute('analyze').status, 0)
})

test('scanner errors and inconsistent reports fail closed and save failure evidence', (t) => {
  for (const status of [1, 2]) {
    const fixture = pipelineFixture(t, { results: [] }, status)
    assert.notEqual(fixture.execute('scan').status, 0)
    assert.ok(existsSync(join(fixture.directory, 'failure.txt')))
    assert.match(readFileSync(join(fixture.directory, 'report.md'), 'utf8'), /Статус: failed/u)
  }
})

test('pipeline rejects reports in checkout and dispatches from a non-default branch', (t) => {
  const fixture = pipelineFixture(t)
  assert.notEqual(
    fixture.execute('scan', { AUDIT_DIR: resolve('.audit-should-not-exist') }).status,
    0
  )
  assert.ok(!existsSync(resolve('.audit-should-not-exist')))
  const result = fixture.execute('scan', { GITHUB_REF: 'refs/heads/feature' })
  assert.notEqual(result.status, 0)
})
