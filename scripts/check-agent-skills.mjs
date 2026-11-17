import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const skills = ['to-spec', 'to-tickets', 'implement-spec', 'tdd', 'code-review', 'codebase-design']
const root = new URL('../', import.meta.url)

for (const skill of skills) {
  const path = `.opencode/skills/${skill}/SKILL.md`
  const content = readFileSync(new URL(path, root), 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content)?.[1]
  assert.ok(frontmatter, `${path}: missing frontmatter`)
  assert.match(frontmatter, new RegExp(`^name: ${skill}$`, 'm'), `${path}: incorrect name`)
  assert.match(frontmatter, /^description: \S.+$/m, `${path}: missing description`)
  assert.doesNotMatch(
    frontmatter,
    /^(?:disable-model-invocation:\s*true|[ \t]*opencode\/autoinvoke:\s*false)\s*$/m,
    `${path}: skill must be discoverable from an /oc text request`
  )
}

for (const path of [
  '.opencode/skills/tdd/tests.md',
  '.opencode/skills/tdd/mocking.md',
  '.opencode/skills/codebase-design/DEEPENING.md',
  '.opencode/skills/codebase-design/DESIGN-IT-TWICE.md',
  '.opencode/skills/LICENSE',
  'AGENTS.md',
  'docs/agents/issue-tracker.md',
  'docs/agents/triage-labels.md',
  'docs/agents/domain.md',
  'docs/agents/opencode.md'
]) {
  assert.ok(readFileSync(new URL(path, root), 'utf8').trim(), `${path}: file is empty`)
}

console.log(`Agent skills ready: ${skills.join(', ')}`)
