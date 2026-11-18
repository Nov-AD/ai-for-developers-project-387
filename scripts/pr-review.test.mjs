import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  parseReview,
  patchLines,
  prepareReview,
  publishReview,
  referencedIssues,
  renderReview,
  reviewFingerprint,
  reviewFromEvents,
  reviewSkipReason,
  validateReviewPolicy
} from './pr-review.mjs'

const repository = 'owner/calendar'
const pr = {
  number: 20,
  state: 'open',
  draft: false,
  locked: false,
  title: 'feat: filters (#10)',
  body: 'Closes #10',
  changed_files: 1,
  user: { type: 'User', login: 'owner' },
  author_association: 'OWNER',
  head: { sha: 'a'.repeat(40), ref: 'feat/filters', repo: { full_name: repository } },
  base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: repository } }
}
const event = {
  action: 'opened',
  number: 20,
  pull_request: pr,
  repository: { default_branch: 'main' }
}
const files = [
  {
    filename: 'apps/web/src/filters.ts',
    changes: 2,
    additions: 1,
    deletions: 1,
    patch: '@@ -1,2 +1,2 @@\n const x = 1\n-return x\n+return x + 1'
  }
]
const review = {
  summary: 'Найдено замечание.',
  findings: [
    {
      severity: 'medium',
      path: files[0].filename,
      line: 2,
      body: 'Результат смещён на единицу.'
    }
  ]
}
const raw = JSON.stringify(review)

function fakeApi(current = pr, comments = []) {
  const calls = []
  const api = async (method, route) => {
    calls.push({ method, route })
    assert.equal(method, 'GET')
    if (route === `repos/${repository}/pulls/20`) return current
    if (route.includes('/files?')) return files
    if (route === `repos/${repository}/issues/10`) return { number: 10, body: 'Spec #9' }
    if (route === `repos/${repository}/issues/9`) return { number: 9, body: 'Parent #10' }
    if (route.includes('/issues/10/comments?')) return [{ body: 'Approved; implement-spec' }]
    if (route.includes('/issues/9/comments?')) return [{ body: 'Spec approved' }]
    if (route.includes('/issues/20/comments?')) return comments
    if (route.includes('/check-runs?'))
      return { check_runs: [{ name: 'CI', status: 'in_progress' }] }
    if (route.includes('/actions/runs?')) return { workflow_runs: [] }
    return []
  }
  return { api, calls }
}

test('review trusts members and OpenCode PRs from own opencode branches, not arbitrary bots', () => {
  for (const author_association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    assert.equal(reviewSkipReason(repository, event, { ...pr, author_association }), null)
  }
  const bot = {
    ...pr,
    user: { type: 'Bot', login: 'opencode-agent[bot]' },
    author_association: 'CONTRIBUTOR',
    head: { ...pr.head, ref: 'opencode/issue10-20261118' }
  }
  assert.equal(reviewSkipReason(repository, event, bot), null)
  for (const current of [
    { ...pr, author_association: 'CONTRIBUTOR' },
    { ...bot, user: { type: 'Bot', login: 'another[bot]' } },
    { ...bot, user: { type: 'User', login: 'opencode-agent[bot]' } },
    { ...bot, head: { ...pr.head, ref: 'untrusted' } },
    { ...bot, head: { ...bot.head, repo: { full_name: 'outsider/calendar' } } }
  ])
    assert.ok(reviewSkipReason(repository, event, current))
})

test('forks, drafts, closed, wrong branch and stale events are rejected before collecting context', async () => {
  for (const current of [
    { ...pr, state: 'closed' },
    { ...pr, draft: true },
    { ...pr, locked: true },
    { ...pr, number: 21 },
    { ...pr, head: { ...pr.head, repo: null } },
    { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } },
    { ...pr, base: { ...pr.base, sha: 'c'.repeat(40) } },
    { ...pr, base: { ...pr.base, ref: 'other' } },
    { ...pr, base: { ...pr.base, repo: { full_name: 'outsider/calendar' } } }
  ]) {
    const { api, calls } = fakeApi(current)
    assert.ok((await prepareReview(api, repository, event)).reason)
    assert.equal(calls.length, 1)
  }
  assert.ok(reviewSkipReason(repository, { ...event, action: 'edited' }, pr))
  for (const action of ['synchronize', 'reopened', 'ready_for_review']) {
    assert.equal(reviewSkipReason(repository, { ...event, action }, pr), null)
  }
})

test('preparation collects full discussion, recursive spec approvals, commit and CI snapshots', async () => {
  const { api, calls } = fakeApi()
  const result = await prepareReview(api, repository, event)
  assert.equal(result.fingerprint, reviewFingerprint(pr))
  assert.deepEqual(result.input.files, files)
  assert.equal(result.input.issues.length, 2)
  assert.equal(result.input.issues[1].comments[0].body, 'Spec approved')
  for (const route of [
    '/reviews?',
    '/pulls/20/comments?',
    '/commits?',
    '/statuses?',
    '/actions/runs?'
  ]) {
    assert.ok(
      calls.some((entry) => entry.route.includes(route)),
      route
    )
  }
  assert.equal(result.input.checks[0].status, 'in_progress')
})

test('references are deduplicated, restricted to local shorthand and local full URLs', () => {
  assert.deepEqual(
    referencedIssues(repository, '#10 #10 https://github.com/owner/calendar/issues/9'),
    [10, 9]
  )
  assert.deepEqual(
    referencedIssues(repository, 'https://github.com/other/repo/issues/8 other/repo#7'),
    []
  )
})

test('unavailable specification or approval context is explicit evidence, not silent assumed approval', async () => {
  const base = fakeApi()
  const api = (method, route) => {
    if (route === `repos/${repository}/issues/10`) throw new Error('GitHub GET failed (404)')
    return base.api(method, route)
  }
  const result = await prepareReview(api, repository, event)
  assert.equal(result.input.issues.length, 0)
  assert.equal(result.input.contextGaps[0].number, 10)
  assert.match(result.input.contextGaps[0].reason, /unavailable/)
})

test('review includes artifact metadata for this head SHA and prior human decisions', async () => {
  const base = fakeApi(pr, [{ user: { login: 'owner' }, body: 'Отклонено: не воспроизводится' }])
  const api = (method, route) => {
    if (route.includes('/actions/runs?'))
      return { workflow_runs: [{ id: 99, head_sha: pr.head.sha }] }
    if (route.includes('/actions/runs/99/artifacts?')) {
      return { artifacts: [{ name: `pr-20-head-${pr.head.sha}`, expired: false }] }
    }
    return base.api(method, route)
  }
  const result = await prepareReview(api, repository, event)
  assert.match(result.input.artifacts[0].name, new RegExp(pr.head.sha, 'u'))
  assert.match(result.input.comments[0].body, /Отклонено/)
})

test('large REST metadata cannot crowd out complete review evidence', async () => {
  const noise = { url: 'unused'.repeat(16000), owner: { avatar_url: 'unused'.repeat(16000) } }
  const user = { id: 1, login: 'owner', type: 'User' }
  const comment = {
    id: 2,
    body: 'Согласовано без сокращений.\nУсловие: сохранить соседний сценарий.',
    user,
    author_association: 'OWNER',
    html_url: 'https://github.com/owner/calendar/issues/10#issuecomment-2',
    created_at: '2026-11-18T10:00:00Z',
    updated_at: '2026-11-18T10:01:00Z'
  }
  const inline = {
    ...comment,
    path: files[0].filename,
    line: 2,
    original_line: 1,
    start_line: 1,
    original_start_line: 1,
    side: 'RIGHT',
    start_side: 'RIGHT',
    diff_hunk: files[0].patch,
    commit_id: pr.head.sha,
    original_commit_id: pr.base.sha,
    in_reply_to_id: 1,
    pull_request_review_id: 3
  }
  const reviewEntry = { ...comment, state: 'CHANGES_REQUESTED', commit_id: pr.head.sha }
  const commit = {
    sha: pr.head.sha,
    commit: { message: 'fix: preserve evidence (#10)', author: { name: 'Owner', date: 'today' } },
    author: user
  }
  const check = {
    id: 4,
    name: 'CI',
    head_sha: pr.head.sha,
    status: 'completed',
    conclusion: 'failure',
    details_url: 'https://example.com/check',
    output: { title: 'Failure', summary: 'Full summary\nSecond line', text: 'Full log excerpt' },
    app: { id: 5, slug: 'github-actions', name: 'GitHub Actions' }
  }
  const status = {
    id: 6,
    context: 'external check',
    state: 'pending',
    description: 'Waiting for evidence',
    target_url: 'https://example.com/status',
    creator: user
  }
  const run = {
    id: 7,
    name: 'PR head verification',
    display_title: 'Full run title',
    head_sha: pr.head.sha,
    run_attempt: 2,
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://example.com/run',
    actor: user
  }
  const artifact = {
    id: 8,
    name: `pr-20-head-${pr.head.sha}`,
    expired: false,
    size_in_bytes: 123,
    archive_download_url: 'https://example.com/artifact',
    expires_at: '2026-12-02T10:00:00Z',
    workflow_run: { id: run.id, head_sha: pr.head.sha }
  }
  const issue = {
    number: 10,
    title: 'Full specification',
    body: 'Full specification\nEvery condition is retained.',
    state: 'open',
    user,
    author_association: 'OWNER',
    labels: [{ name: 'ready-for-agent' }]
  }
  const noisy = (entry) => ({
    ...entry,
    repository: noise,
    node_id: noise.url,
    ...(entry.user && { user: { ...entry.user, ...noise } })
  })
  const base = fakeApi()
  const api = (method, route) => {
    if (route === `repos/${repository}/issues/10`)
      return { ...noisy(issue), labels: issue.labels.map(noisy) }
    if (route.includes('/files?')) return files.map(noisy)
    if (/\/issues\/(10|20)\/comments\?/u.test(route)) return [noisy(comment)]
    if (route.includes('/pulls/20/comments?')) return [noisy(inline)]
    if (route.includes('/reviews?')) return [noisy(reviewEntry)]
    if (route.includes('/commits?'))
      return [{ ...noisy(commit), commit: { ...commit.commit, tree: noise } }]
    if (route.includes('/check-runs?')) return { check_runs: [noisy(check)] }
    if (route.includes('/statuses?')) return [noisy(status)]
    if (route.includes('/actions/runs?')) return { workflow_runs: [noisy(run)] }
    if (route.includes('/actions/runs/7/artifacts?'))
      return { artifacts: [{ ...noisy(artifact), workflow_run: noisy(artifact.workflow_run) }] }
    return base.api(method, route)
  }
  const { input } = await prepareReview(api, repository, event)
  assert.deepEqual(input.files, files)
  assert.deepEqual(input.issues, [{ issue, comments: [comment] }])
  assert.deepEqual(input.comments, [comment])
  assert.deepEqual(input.inlineComments, [inline])
  assert.deepEqual(input.reviews, [reviewEntry])
  assert.deepEqual(input.commits, [commit])
  assert.deepEqual(input.checks, [check])
  assert.deepEqual(input.statuses, [status])
  assert.deepEqual(input.runs, [run])
  assert.deepEqual(input.artifacts, [artifact])
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < 10000)
})

test('full evidence above the former inline limit is retained for file attachments', async () => {
  const body = 'Полное обсуждение.\n'.repeat(4000)
  const { input } = await prepareReview(
    fakeApi(pr, [{ body, author_association: 'OWNER' }]).api,
    repository,
    event
  )
  assert.equal(input.comments[0].body, body)
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 90000)
  assert.ok(Buffer.byteLength(JSON.stringify(input)) <= 256000)
})

test('oversized evidence still fails closed with its measured UTF-8 size and limit', async () => {
  const base = fakeApi()
  const api = (method, route) =>
    route.includes('/issues/10/comments?')
      ? [{ body: 'я'.repeat(128001), user: { login: 'owner', type: 'User' } }]
      : base.api(method, route)
  await assert.rejects(
    prepareReview(api, repository, event),
    /review context too large \(\d+ > 256000 bytes\); manual review required/u
  )
})

test('incomplete or oversized diffs stop analysis instead of silently reviewing part of a PR', async () => {
  await assert.rejects(
    prepareReview(fakeApi({ ...pr, changed_files: 2 }).api, repository, event),
    /incomplete/
  )
  const base = fakeApi()
  const missing = (method, route) =>
    route.includes('/files?') ? [{ ...files[0], patch: undefined }] : base.api(method, route)
  await assert.rejects(prepareReview(missing, repository, event), /missing or truncated/)
  const truncated = (method, route) =>
    route.includes('/files?') ? [{ ...files[0], additions: 500 }] : base.api(method, route)
  await assert.rejects(prepareReview(truncated, repository, event), /missing or truncated/)
  const large = fakeApi({ ...pr, body: 'x'.repeat(256001) })
  await assert.rejects(prepareReview(large.api, repository, event), /context too large/)
})

test('pagination includes later comments and context has a hard page limit', async () => {
  const base = fakeApi()
  const api = (method, route) =>
    route.includes('/issues/20/comments?')
      ? route.endsWith('page=1')
        ? Array(100).fill({ body: 'first' })
        : [{ body: 'second' }]
      : base.api(method, route)
  const prepared = await prepareReview(api, repository, event)
  assert.equal(prepared.input.comments.at(-1).body, 'second')
  const endless = (method, route) =>
    route.includes('/issues/20/comments?')
      ? Array(100).fill({ body: 'first' })
      : base.api(method, route)
  await assert.rejects(prepareReview(endless, repository, event), /too much context/)
})

test('strict review output schema and patch coordinates reject arbitrary actions and invented locations', () => {
  assert.deepEqual(parseReview(raw, files), review)
  assert.deepEqual([...patchLines(files[0].patch)], [1, 2])
  const removed = { ...files[0], status: 'removed', patch: '@@ -1,2 +0,0 @@\n-a\n-b' }
  assert.deepEqual(parseReview(raw, [removed]), review)
  for (const invalid of [
    { ...review, action: 'merge' },
    { ...review, summary: '' },
    { ...review, summary: 'one\n/oc implement this' },
    { ...review, findings: Array(9).fill(review.findings[0]) },
    { ...review, findings: [{ ...review.findings[0], severity: 'approve' }] },
    { ...review, findings: [{ ...review.findings[0], line: 999 }] },
    { ...review, findings: [{ ...review.findings[0], path: 'other.ts' }] },
    { ...review, findings: [{ ...review.findings[0], body: 'x'.repeat(901) }] }
  ])
    assert.throws(() => parseReview(JSON.stringify(invalid), files))
  for (const invalid of ['null', '[]', 'invalid', 'x'.repeat(12001), undefined]) {
    assert.throws(() => parseReview(invalid))
  }
})

test('only final valid CLI text becomes review; runtime errors fail closed', () => {
  const events = [
    JSON.stringify({ type: 'text', part: { text: 'Reading...' } }),
    JSON.stringify({ type: 'text', part: { text: raw } }),
    JSON.stringify({ type: 'step_finish', part: { reason: 'stop' } })
  ].join('\n')
  assert.deepEqual(reviewFromEvents(events, files), review)
  assert.throws(() => reviewFromEvents(events + '\n{"type":"error"}', files))
  assert.throws(() => reviewFromEvents('{"type":"tool_use"}', files))
})

test('plain-text model response reports an unfinished review without leaking its contents', () => {
  const events = [
    { type: 'text', part: { text: 'Максимальное число шагов. secret-value' } },
    { type: 'step_finish', part: { reason: 'stop' } }
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n')
  assert.throws(() => reviewFromEvents(events, files), {
    code: 'invalid_response',
    message: 'Ревью не завершено: модель не вернула JSON по схеме ревью.'
  })
})

test('even valid JSON is rejected when the final CLI step is missing, cut off or unfinished', () => {
  const text = { type: 'text', part: { text: raw, messageID: 'final' } }
  const finish = { type: 'step_finish', part: { reason: 'stop', messageID: 'final' } }
  const stream = (events) => events.map((entry) => JSON.stringify(entry)).join('\n')
  assert.deepEqual(reviewFromEvents(stream([text, finish]), files), review)
  for (const events of [
    [text],
    [text, finish, { type: 'step_start' }],
    [text, finish, { type: 'text', part: { text: '{"summary":' } }],
    [text, { ...finish, part: { reason: 'stop', messageID: 'other' } }],
    ...['length', 'tool-calls', 'content-filter', 'error', 'unknown', undefined].map((reason) => [
      text,
      { ...finish, part: { reason, messageID: 'final' } }
    ])
  ]) {
    assert.throws(() => reviewFromEvents(stream(events), files), { code: 'incomplete_response' })
  }
  for (const output of ['', 'null', stream([text, finish]) + '\n{"type":']) {
    assert.throws(() => reviewFromEvents(output, files), { code: 'invalid_stream' })
  }
  assert.throws(() => reviewFromEvents(stream([text, finish, { type: 'error' }]), files), {
    code: 'runtime_error'
  })
})

test('publisher comments only on triggering PR; changed, stale, closed and duplicate results are skipped', async () => {
  const published = []
  const comment = (number, body) => published.push({ number, body })
  assert.equal(
    await publishReview(fakeApi().api, repository, event, raw, reviewFingerprint(pr), comment),
    null
  )
  assert.equal(published.length, 1)
  assert.equal(published[0].number, 20)
  assert.match(published[0].body, /решение о мерже остаётся за человеком/)
  for (const current of [
    { ...pr, body: 'edited' },
    { ...pr, title: 'edited' },
    { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } },
    { ...pr, state: 'closed' }
  ]) {
    assert.ok(
      await publishReview(
        fakeApi(current).api,
        repository,
        event,
        raw,
        reviewFingerprint(pr),
        comment
      )
    )
  }
  const duplicate = {
    body: renderReview(review, pr, reviewFingerprint(pr)),
    user: { login: 'github-actions[bot]', type: 'Bot' }
  }
  assert.ok(
    await publishReview(
      fakeApi(pr, [duplicate]).api,
      repository,
      event,
      raw,
      reviewFingerprint(pr),
      comment
    )
  )
  assert.equal(published.length, 1)
  const spoof = { ...duplicate, user: { login: 'owner', type: 'User' } }
  assert.equal(
    await publishReview(
      fakeApi(pr, [spoof]).api,
      repository,
      event,
      raw,
      reviewFingerprint(pr),
      comment
    ),
    null
  )
  assert.equal(published.length, 2)
})

test('invalid output or API errors never publish', async () => {
  const { api, calls } = fakeApi()
  const comment = () => assert.fail('must not publish')
  await assert.rejects(
    publishReview(api, repository, event, '{"action":"merge"}', reviewFingerprint(pr), comment)
  )
  await assert.rejects(publishReview(api, repository, event, raw, 'invalid', comment))
  assert.equal(calls.length, 0)
  await assert.rejects(
    publishReview(
      () => {
        throw new Error('403')
      },
      repository,
      event,
      raw,
      reviewFingerprint(pr),
      comment
    ),
    /403/
  )
})

test('review text neutralizes mentions and Markdown; no findings never implies approval', () => {
  const rendered = renderReview(
    {
      summary: '@everyone [click](https://example.com)',
      findings: []
    },
    pr,
    reviewFingerprint(pr)
  )
  assert.ok(!rendered.includes('@everyone'))
  assert.match(rendered, /\\\[click\\\]/)
  assert.match(rendered, /это не approval/)
  assert.match(rendered, /Тесты не запускались/)
})

test('effective runtime policy denies writes, shell, subagents, skills and MCP', () => {
  const agent = {
    id: 'pr-review',
    mode: 'primary',
    steps: 24,
    permissions: [
      { action: '*', resource: '*', effect: 'allow' },
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'read', resource: '*', effect: 'allow' }
    ]
  }
  validateReviewPolicy([agent])
  assert.throws(() => validateReviewPolicy([]))
  assert.throws(() => validateReviewPolicy([{ ...agent, steps: undefined }]))
  for (const steps of [16, 23, 25]) {
    assert.throws(() => validateReviewPolicy([{ ...agent, steps }]))
  }
  assert.throws(() => validateReviewPolicy([{ ...agent, permissions: [] }]))
  for (const action of [
    'edit',
    'shell',
    'execute',
    'subagent',
    'skill',
    'external_directory',
    'github_merge'
  ]) {
    assert.throws(() =>
      validateReviewPolicy([
        {
          ...agent,
          permissions: [...agent.permissions, { action, resource: '*', effect: 'allow' }]
        }
      ])
    )
  }
})

test('review agent bounds research and keeps JSON finalization when runtime requests a summary', () => {
  const agent = readFileSync(new URL('../.opencode/agents/pr-review.md', import.meta.url), 'utf8')
  assert.match(agent, /^steps: 24$/mu)
  assert.match(agent, /at most 20 model steps for research/u)
  assert.match(agent, /reserve the\nremaining four steps for finalization/u)
  assert.match(
    agent,
    /runtime\nremoves tools, requests a summary, or reports a step\/time\/context limit/u
  )
  assert.match(agent, /unreviewed scope and need for human review/u)
  assert.match(agent, /first non-whitespace character is `\{` and the last\nis `\}`/u)
})

test('workflow separates review from write token, uses CLI not github run, never checks out PR head', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/pr-review.yml', import.meta.url),
    'utf8'
  )
  assert.match(
    workflow,
    /pull_request:\n\s+types: \[opened, synchronize, reopened, ready_for_review\]/
  )
  assert.match(workflow, /cancel-in-progress: true/)
  assert.match(workflow, /timeout-minutes: 12/)
  assert.match(workflow, /head\.repo\.full_name == github\.repository/)
  assert.match(workflow, /opencode-agent\[bot\]/)
  assert.doesNotMatch(
    workflow,
    /user\.type != 'Bot'|pull_request_target|id-token:|secrets\.|contents: write|anomalyco\/opencode\/github/
  )
  assert.doesNotMatch(workflow, /ref:.*(head|merge)|gh pr (merge|edit|review)/)
  const [analysis, publication] = workflow.split('\n  publish:')
  for (const permission of [
    'contents',
    'issues',
    'pull-requests',
    'actions',
    'checks',
    'statuses'
  ]) {
    assert.ok(analysis.includes(`${permission}: read`))
  }
  assert.doesNotMatch(analysis, /: write/)
  assert.match(publication, /pull-requests: write/)
  assert.doesNotMatch(publication, /npm ci|REVIEW_CLI|id-token/)
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2)
  assert.match(workflow, /OPENCODE_AUTO_REVIEW != 'off'/)
  assert.match(workflow, /REVIEW_CRITERIA: REVIEW\.md/)
  assert.match(workflow, /oc-budget-v1:pr:/)
  assert.match(analysis, /review_failure: \$\{\{ steps\.analysis\.outputs\.review_failure \}\}/u)
  assert.match(analysis, /if: failure\(\) && steps\.analysis\.outcome == 'failure'/u)
  assert.match(analysis, /actions\/upload-artifact@[a-f0-9]{40}/u)
  assert.match(analysis, /path: \$\{\{ runner\.temp \}\}\/review-diagnostics\.json/u)
  assert.match(analysis, /retention-days: 7/u)
  assert.match(
    analysis,
    /if: always\(\) && \(steps\.analysis\.outcome == 'success' \|\| steps\.analysis\.outcome == 'failure'\)/u
  )
  assert.match(analysis, /-review-metrics-/u)
  assert.match(analysis, /path: \$\{\{ runner\.temp \}\}\/review-metrics\.json/u)
  assert.match(analysis, /retention-days: 30/u)
  assert.match(publication, /REVIEW_FAILURE: \$\{\{ needs\.analyze\.outputs\.review_failure \}\}/u)
})
