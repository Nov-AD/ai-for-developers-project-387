import assert from 'node:assert/strict'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { githubClient } from './auto-triage.mjs'

export const attemptLimit = 5
const workflows = ['opencode.yml', 'pr-review.yml']
const trusted = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

export function humanRequest(event) {
  const comment = event.comment
  return (
    comment?.user?.type === 'User' &&
    !comment.user.login.endsWith('[bot]') &&
    trusted.has(comment.author_association) &&
    /\/(?:opencode|oc)/iu.test(comment.body ?? '')
  )
}

export function discussionNumber(event) {
  const number = event.issue?.number ?? event.pull_request?.number
  assert.ok(Number.isSafeInteger(number) && number > 0, 'invalid discussion number')
  return number
}

export function isPullRequest(event) {
  return Boolean(event.pull_request || event.issue?.pull_request)
}

async function workflowHistory(api, repository, workflow) {
  const history = []
  for (let page = 1; ; page++) {
    assert.ok(page <= 50, 'history exceeds verified budget window; human investigation required')
    const result = await api(
      'GET',
      `repos/${repository}/actions/workflows/${workflow}/runs?per_page=100&page=${page}`
    )
    assert.ok(Array.isArray(result.workflow_runs), 'invalid Actions history')
    history.push(...result.workflow_runs)
    if (result.workflow_runs.length < 100) {
      assert.equal(history.length, result.total_count, 'incomplete Actions history')
      return history
    }
  }
}

export async function inspectBudget(api, repository, number, runId, runAttempt) {
  assert.ok(Number.isSafeInteger(number) && number > 0, 'invalid PR number')
  assert.ok(Number.isSafeInteger(runId) && Number.isSafeInteger(runAttempt) && runAttempt > 0)
  // The agent's App must not be able to delete/rerun Actions or rewrite workflows.
  const app = await api('GET', 'apps/opencode-agent')
  assert.equal(
    app.permissions?.actions,
    'read',
    'App Actions permission changed; budget is not safe'
  )
  assert.ok(
    !app.permissions.workflows || app.permissions.workflows === 'read',
    'App can rewrite workflows; budget is not safe'
  )
  const runs = []
  for (const workflow of workflows) runs.push(...(await workflowHistory(api, repository, workflow)))
  const marker = new RegExp(`^oc-budget-v1:pr:${number}:(?:comment:\\d+|review)$`, 'u')
  const counted = runs.filter(
    (run) =>
      marker.test(run.display_title ?? '') &&
      ['issue_comment', 'pull_request_review_comment', 'pull_request'].includes(run.event)
  )
  assert.equal(
    new Set(counted.map((run) => run.id)).size,
    counted.length,
    'duplicate Actions history'
  )
  const current = counted.find((run) => run.id === runId)
  assert.ok(
    current && current.run_attempt === runAttempt,
    'current attempt is not visible in history'
  )
  let requests = 0
  for (const run of counted) {
    assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, 'invalid run_attempt')
    requests += run.run_attempt
  }
  return {
    allowed: requests <= attemptLimit,
    reason: requests <= attemptLimit ? '' : 'limit_exhausted',
    requests,
    spent: Math.min(requests, attemptLimit)
  }
}

export function resultReason({ budgetReason, preparation, agent, worker, agentReason }) {
  if (budgetReason === 'limit_exhausted') return 'limit_exhausted'
  if (preparation !== 'success') return 'infra'
  if (['timeout', 'infra', 'agent_failed'].includes(agentReason)) return agentReason
  if (agent === 'skipped' || !agent) return 'infra'
  if (worker === 'success' && agent === 'success') return 'success'
  // Cancellation, hard runner death or an unknown error needs log inspection.
  return 'agent_failed'
}

export function renderAgentResult({ reason, sha, url, requests }) {
  const count = requests === '' ? undefined : requests
  assert.ok(['success', 'limit_exhausted', 'timeout', 'infra', 'agent_failed'].includes(reason))
  assert.match(sha, /^[a-f0-9]{40}$/u)
  assert.match(url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+\/attempts\/\d+$/u)
  assert.ok(count === undefined || /^\d+$/u.test(String(count)), 'invalid attempt count')
  return [
    '<!-- opencode:agent-result:v1 -->',
    `**${reason === 'success' ? 'Завершено; решение за человеком' : 'Нужен человек'}**`,
    '',
    `Причина: \`${reason}\`. Последний head SHA: \`${sha}\`.`,
    `Общий бюджет PR: ${attemptLimit} попыток; записей попыток в истории: ${count ?? 'не определено'}.`,
    `[Логи запуска](${url}).`,
    '',
    reason === 'limit_exhausted'
      ? 'Модель не вызывалась. Следующее действие выбирает человек; автоматического продолжения нет.'
      : 'Сверьте результат и причину с логами. Неопределённый сбой или отмена требуют расследования человеком.',
    'История Actions и run_attempt — источник бюджета; редактирование этого комментария его не меняет.'
  ].join('\n')
}

function output(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const repository = process.env.GITHUB_REPOSITORY
  const api = githubClient(repository, process.env.GH_TOKEN)
  const mode = process.argv[2]
  const number = discussionNumber(event)
  if (mode === 'admit') {
    assert.ok(humanRequest(event), 'not an admitted human command')
    output('is_pr', String(isPullRequest(event)))
    if (!isPullRequest(event)) {
      await api('GET', `repos/${repository}/issues/${number}`)
      output('allowed', 'true')
      return
    }
    const pr = await api('GET', `repos/${repository}/pulls/${number}`)
    assert.equal(pr.head.repo.full_name, repository, 'fork PR is not eligible')
    assert.equal(pr.state, 'open', 'closed PR is not eligible')
    const budget = await inspectBudget(
      api,
      repository,
      number,
      Number(process.env.GITHUB_RUN_ID),
      Number(process.env.GITHUB_RUN_ATTEMPT)
    )
    for (const [key, value] of Object.entries(budget)) output(key, String(value))
    output('sha', pr.head.sha)
    return
  }
  assert.equal(mode, 'report')
  assert.ok(humanRequest(event) && isPullRequest(event), 'not an admitted PR request')
  const pr = await api('GET', `repos/${repository}/pulls/${number}`)
  const reason = resultReason({
    budgetReason: process.env.BUDGET_REASON,
    preparation: process.env.ADMISSION_RESULT,
    agent: process.env.AGENT_OUTCOME,
    worker: process.env.WORKER_RESULT,
    agentReason: process.env.AGENT_REASON
  })
  await api('POST', `repos/${repository}/issues/${number}/comments`, {
    body: renderAgentResult({
      reason,
      sha: pr.head.sha,
      requests: process.env.BUDGET_REQUESTS,
      url: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
