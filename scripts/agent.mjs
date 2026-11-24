/**
 * Minimal helper for maintenance scripts: calls the deployed app's agent
 * tools through the DeepSpace CLI as the signed-in owner
 * (`npx deepspace agent invoke`). RBAC applies as for that user.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function invoke(app, tool, input) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-agent-'))
  const file = join(dir, 'input.json')
  try {
    writeFileSync(file, JSON.stringify(input))
    const out = execFileSync('npx', ['deepspace', 'agent', 'invoke', app, tool, '--input-file', file, '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(out)
    if (!parsed.ok || parsed.result?.success === false) throw new Error(`${tool} failed: ${out.slice(0, 400)}`)
    return parsed.result?.data
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function query(app, collection, where = undefined, limit = 1000) {
  const data = invoke(app, 'records_query', where ? { collection, where, limit } : { collection, limit })
  return data?.records ?? []
}

/**
 * All concepts of a paper. The agent tool trims large responses, so this
 * reads one branch at a time (a branch holds a handful of concepts).
 */
export function conceptsOf(app, paper) {
  const out = []
  const seen = new Set()
  for (const b of paper.data.branches ?? []) {
    for (const c of query(app, 'concepts', { paperId: paper.recordId, branchKey: b.key }, 100)) {
      if (!seen.has(c.recordId)) {
        seen.add(c.recordId)
        out.push(c)
      }
    }
  }
  return out
}
