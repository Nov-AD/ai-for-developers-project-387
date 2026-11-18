import { writeFileSync } from 'node:fs'

const finishReasons = new Set([
  'stop',
  'length',
  'tool-calls',
  'content-filter',
  'error',
  'unknown'
])

function redactResponse(text, env) {
  let redacted = text
  const secrets = Object.entries(env)
    .filter(([key, value]) => /token|key|secret|password|credential/iu.test(key) && value)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length)
  for (const secret of secrets) redacted = redacted.replaceAll(secret, '<REDACTED>')
  redacted = redacted
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gu,
      '<REDACTED>'
    )
    .replace(/https?:\/\/[^\s]+/giu, '<REDACTED>')
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-)[a-zA-Z0-9_-]+/gu, '<REDACTED>')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/gu, '<REDACTED>')
    .replace(/[a-zA-Z0-9_+/=-]{32,}/gu, '<REDACTED>')
    .split('\n')
    .map((line) =>
      /authorization|cookie|token|secret|password|api.?key|парол|секрет/iu.test(line)
        ? '<REDACTED>'
        : line
    )
    .join('\n')
  return { response: redacted.slice(0, 8000), responseTruncated: redacted.length > 8000 }
}

function reviewData(result) {
  const events = []
  let malformedLines = 0
  for (const line of (result.stdout ?? '').trim().split('\n')) {
    try {
      const event = JSON.parse(line)
      if (!event || typeof event.type !== 'string') throw new Error('invalid event')
      events.push(event)
    } catch {
      malformedLines++
    }
  }
  const finish = events.findLast((event) => event.type === 'step_finish')?.part?.reason
  return {
    events,
    metrics: {
      exitCode: result.status,
      signal: result.signal,
      stepsStarted: events.filter((event) => event.type === 'step_start').length,
      stepsFinished: events.filter((event) => event.type === 'step_finish').length,
      finishReason: finishReasons.has(finish) ? finish : 'unavailable',
      malformedLines
    }
  }
}

export function writeReviewMetrics(path, result, outcome) {
  // The success artifact contains only counters/status, never model or PR content.
  const { metrics } = reviewData(result)
  const record = { outcome, ...metrics }
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  return record
}

export function writeReviewDiagnostics(path, result, failure) {
  // Never retain the raw event stream, tool inputs/results, reasoning or stderr.
  const { events, metrics } = reviewData(result)
  const text = events.findLast((event) => event.type === 'text')?.part?.text
  const diagnostic = {
    failure,
    ...metrics,
    ...redactResponse(typeof text === 'string' ? text : '', process.env)
  }
  writeFileSync(path, JSON.stringify(diagnostic, null, 2) + '\n', { mode: 0o600 })
}
