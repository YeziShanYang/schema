/**
 * Minimal helper for maintenance scripts: calls the deployed app's agent
 * tools through the DeepSpace CLI as the signed-in owner
 * (`npx deepspace agent invoke`). RBAC applies as for that user.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * Text of one of the app's stored files (`npx deepspace app files get`), or
 * '' when it can't be read. Accepts a stored key with its `apps/<id>/` prefix.
 */
export function appFileText(app, storedKey) {
  const key = storedKey.replace(/^apps\/[^/]+\//, '')
  const dir = mkdtempSync(join(tmpdir(), 'schema-file-'))
  const file = join(dir, 'file')
  try {
    execFileSync('npx', ['deepspace', 'app', 'files', 'get', key, '--out', file, '--app', app, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Up to `limit` matching records. The tool caps a page at about 30KB and
 * returns `nextOffset` when more match, so this follows it page by page;
 * without that, a collection of large records (papers with overviews) comes
 * back cut short.
 */
export function query(app, collection, where = undefined, limit = 1000) {
  const out = []
  let offset = 0
  while (out.length < limit) {
    const input = { collection, limit: limit - out.length, ...(where ? { where } : {}), ...(offset ? { offset } : {}) }
    const data = invoke(app, 'records_query', input)
    const page = data?.records ?? []
    out.push(...page)
    if (data?.nextOffset === undefined || page.length === 0) break
    offset = data.nextOffset
  }
  return out
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
