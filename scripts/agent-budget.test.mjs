import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  attemptLimit,
  humanRequest,
  inspectBudget,
  renderAgentResult,
  resultReason
} from './agent-budget.mjs'
import { agentFailureReason, runManualAgent } from './run-manual-agent.mjs'

const repository = 'owner/calendar'
const run = (id, attempt = 1, event = 'issue_comment', number = 20) => ({
  id,
  run_attempt: attempt,
  event,
  display_title: `oc-budget-v1:pr:${number}:${event === 'pull_request' ? 'review' : `comment:${id}`}`
})
const command = {
  issue: { number: 20, pull_request: {} },
  comment: {
    user: { login: 'owner', type: 'User' },
    author_association: 'OWNER',
    body: '/oc fix it'
  }
}

function fakeApi(manual, review = [], permissions = { actions: 'read', contents: 'write' }) {
  const calls = []
  const api = async (method, route) => {
    calls.push({ method, route })
    assert.equal(method, 'GET', 'budget source is read only')
    if (route === 'apps/opencode-agent') return { permissions }
    const runs = route.includes('/opencode.yml/') ? manual : review
    return { total_count: runs.length, workflow_runs: runs }
  }
  return { api, calls }
}

test('both human PR comment channels qualify, bots and unauthorized or unrelated comments do not', () => {
  assert.ok(humanRequest(command))
  assert.ok(humanRequest({ ...command, issue: undefined, pull_request: { number: 20 } }))
  assert.ok(
    humanRequest({ ...command, comment: { ...command.comment, body: '/OPENCODE continue' } })
  )
  for (const comment of [
    { ...command.comment, body: 'looks good' },
    { ...command.comment, author_association: 'NONE' },
    { ...command.comment, user: { type: 'Bot', login: 'opencode-agent[bot]' } },
    { ...command.comment, user: { type: 'User', login: 'fake[bot]' } }
  ])
    assert.ok(!humanRequest({ ...command, comment }))
})

test('shared budget counts general comments, inline comments, review, cancellation and timeout', async () => {
  const manual = [
    { ...run(1), conclusion: 'cancelled' },
    { ...run(2, 1, 'pull_request_review_comment'), conclusion: 'timed_out' },
    run(4),
    run(5, 1, 'pull_request_review_comment')
  ]
  const first = await inspectBudget(
    fakeApi(manual, [run(3, 1, 'pull_request')]).api,
    repository,
    20,
    3,
    1
  )
  assert.deepEqual(first, { allowed: true, reason: '', requests: 5, spent: 5 })
  const exhausted = await inspectBudget(
    fakeApi([...manual, run(6)], [run(3, 1, 'pull_request')]).api,
    repository,
    20,
    6,
    1
  )
  assert.deepEqual(exhausted, {
    allowed: false,
    reason: 'limit_exhausted',
    requests: 6,
    spent: 5
  })
  assert.equal(attemptLimit, 5)
})

test('rerunning the same run spends another attempt, including rerunning only failed jobs', async () => {
  const result = await inspectBudget(fakeApi([run(1, 5), run(2)]).api, repository, 20, 1, 5)
  assert.equal(result.requests, 6)
  assert.equal(result.allowed, false)
})

test('new PR starts its own budget; comments or unrelated/skipped workflow names cannot change it', async () => {
  const { api, calls } = fakeApi([
    run(1, 10, 'issue_comment', 19),
    run(2),
    { ...run(3, 100), display_title: 'opencode (outside PR budget)' },
    { ...run(4, 100), display_title: 'oc-budget-v1:pr:20:comment:evil' },
    { ...run(5, 100), event: 'workflow_dispatch' }
  ])
  assert.equal((await inspectBudget(api, repository, 20, 2, 1)).requests, 1)
  assert.ok(calls.every((entry) => !entry.route.includes('/comments')))
})

test('missing current attempt, partial history, API failures and unsafe App permissions fail closed', async () => {
  await assert.rejects(inspectBudget(fakeApi([run(1)]).api, repository, 20, 2, 1), /not visible/)
  await assert.rejects(inspectBudget(fakeApi([run(1)]).api, repository, 20, 1, 2), /not visible/)
  await assert.rejects(
    inspectBudget(fakeApi([run(1)], [], { actions: 'write' }).api, repository, 20, 1, 1),
    /permission changed/
  )
  await assert.rejects(
    inspectBudget(
      fakeApi([run(1)], [], { actions: 'read', workflows: 'write' }).api,
      repository,
      20,
      1,
      1
    ),
    /rewrite workflows/
  )
  const incomplete = async (_method, route) =>
    route === 'apps/opencode-agent'
      ? { permissions: { actions: 'read' } }
      : { total_count: 10, workflow_runs: [run(1)] }
  await assert.rejects(inspectBudget(incomplete, repository, 20, 1, 1), /incomplete/)
  await assert.rejects(
    inspectBudget(
      () => {
        throw new Error('403')
      },
      repository,
      20,
      1,
      1
    ),
    /403/
  )
})

test('history pagination counts older attempts too', async () => {
  const runs = Array.from({ length: 101 }, (_, index) => run(index + 1))
  const api = async (_method, route) => {
    if (route === 'apps/opencode-agent') return { permissions: { actions: 'read' } }
    if (route.includes('/pr-review.yml/')) return { total_count: 0, workflow_runs: [] }
    return {
      total_count: 101,
      workflow_runs: route.endsWith('page=1') ? runs.slice(0, 100) : runs.slice(100)
    }
  }
  assert.equal((await inspectBudget(api, repository, 20, 101, 1)).requests, 101)
})

test('report distinguishes exhaustion, infrastructure, bounded timeout, failure and success', () => {
  const state = { preparation: 'success', agent: 'success', worker: 'success' }
  assert.equal(resultReason(state), 'success')
  assert.equal(
    resultReason({ ...state, budgetReason: 'limit_exhausted', agent: 'skipped' }),
    'limit_exhausted'
  )
  assert.equal(resultReason({ ...state, preparation: 'failure' }), 'infra')
  assert.equal(resultReason({ ...state, agent: 'skipped', worker: 'failure' }), 'infra')
  assert.equal(resultReason({ ...state, agentReason: 'timeout', worker: 'failure' }), 'timeout')
  assert.equal(resultReason({ ...state, worker: 'cancelled' }), 'agent_failed')
  assert.equal(agentFailureReason(true, undefined, null, ''), 'timeout')
  assert.equal(agentFailureReason(false, new Error('ENOENT'), null, ''), 'infra')
  assert.equal(agentFailureReason(false, undefined, 1, 'API key is missing'), 'infra')
  assert.equal(agentFailureReason(false, undefined, 1, 'unknown error'), 'agent_failed')
  assert.equal(agentFailureReason(false, undefined, 1, 'OIDC exchange failed', false), 'infra')
  assert.equal(
    agentFailureReason(false, undefined, 0, 'Documented that an API key is missing'),
    'success'
  )
})

test('model-free limit report carries latest SHA, log link and human handoff', () => {
  const body = renderAgentResult({
    reason: 'limit_exhausted',
    sha: 'a'.repeat(40),
    requests: 6,
    url: 'https://github.com/owner/calendar/actions/runs/1/attempts/2'
  })
  assert.match(body, /Нужен человек/)
  assert.match(body, /limit_exhausted/)
  assert.match(body, /Модель не вызывалась/)
  assert.match(body, /Общий бюджет PR: 5 попыток/)
  assert.match(body, /записей попыток в истории: 6/)
  assert.match(body, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/)
  assert.match(body, /attempts\/2/)
  const infra = renderAgentResult({
    reason: 'infra',
    sha: 'a'.repeat(40),
    requests: '',
    url: 'https://github.com/owner/calendar/actions/runs/1/attempts/2'
  })
  assert.match(infra, /не определено/)
  assert.throws(() => renderAgentResult({ reason: 'success', sha: 'invalid' }))
})

test('supervisor actually stops a hung process and reports a missing executable as infra', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'calendar-agent-supervisor-'))
  const script = join(directory, 'agent')
  writeFileSync(script, '#!/bin/sh\nsleep 30\n')
  chmodSync(script, 0o700)
  const start = Date.now()
  assert.equal(await runManualAgent(script, { timeout: 50 }), 'timeout')
  assert.ok(Date.now() - start < 10000)
  assert.equal(await runManualAgent(join(directory, 'missing'), { timeout: 1000 }), 'infra')
})
