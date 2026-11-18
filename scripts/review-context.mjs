import assert from 'node:assert/strict'

// Keep evidence, not REST transport metadata (repositories, avatars, API links).
// Project only after trust, pagination and diff completeness have been checked.
function projection(fields, children = {}) {
  const keys = fields.split(' ')
  return (value) => {
    if (value == null) return value
    const result = Object.fromEntries(
      keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]])
    )
    for (const [key, project] of Object.entries(children)) {
      if (Object.hasOwn(value, key)) result[key] = project(value[key])
    }
    return result
  }
}

const identity = projection('id login type')
const comment = projection(
  'id body html_url author_association created_at updated_at submitted_at state commit_id original_commit_id path line original_line start_line original_start_line side start_side position original_position diff_hunk in_reply_to_id pull_request_review_id subject_type',
  { user: identity }
)
const issue = projection(
  'number title body state state_reason locked html_url author_association created_at updated_at closed_at',
  {
    user: identity,
    labels: (labels) => labels.map(projection('name description')),
    pull_request: projection('html_url merged_at')
  }
)
const file = projection('sha filename previous_filename status additions deletions changes patch')
const commit = projection('sha html_url', {
  author: identity,
  committer: identity,
  commit: projection('message', {
    author: projection('name email date'),
    committer: projection('name email date'),
    verification: projection('verified reason')
  })
})
const check = projection(
  'id name head_sha status conclusion html_url details_url started_at completed_at',
  {
    app: projection('id slug name'),
    output: projection('title summary text annotations_count annotations_url')
  }
)
const status = projection('id context state description target_url created_at updated_at', {
  creator: identity
})
const run = projection(
  'id name display_title workflow_id path event head_branch head_sha run_number run_attempt status conclusion html_url created_at updated_at run_started_at',
  { actor: identity, triggering_actor: identity }
)
const artifact = projection(
  'id name size_in_bytes url archive_download_url expired created_at updated_at expires_at digest',
  {
    workflow_run: projection('id repository_id head_repository_id head_branch head_sha')
  }
)

export function compactReviewContext(input) {
  return {
    ...input,
    files: input.files.map(file),
    issues: input.issues.map((entry) => ({
      issue: issue(entry.issue),
      comments: entry.comments.map(comment)
    })),
    comments: input.comments.map(comment),
    reviews: input.reviews.map(comment),
    inlineComments: input.inlineComments.map(comment),
    commits: input.commits.map(commit),
    checks: input.checks.map(check),
    statuses: input.statuses.map(status),
    runs: input.runs.map(run),
    artifacts: input.artifacts.map(artifact)
  }
}

export function reviewContextParts(input) {
  const text = JSON.stringify(input)
  const bytes = Buffer.byteLength(text)
  assert.ok(
    bytes <= 256000,
    `review context too large (${bytes} > 256000 bytes); manual review required`
  )
  const parts = []
  let part = ''
  let size = 0
  // Iterate code points, never split a UTF-8 sequence or a surrogate pair.
  for (const character of text) {
    const length = Buffer.byteLength(character)
    if (size + length > 90000) {
      parts.push(part)
      part = ''
      size = 0
    }
    part += character
    size += length
  }
  parts.push(part)
  return parts
}
