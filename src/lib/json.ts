/**
 * Pulls a JSON object out of model text that may carry code fences or stray
 * prose around it. Returns null when nothing parses.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(trimmed)
  if (direct) return direct
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return tryParse(trimmed.slice(start, end + 1))
}

export function asString(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function asStringArray(v: unknown, maxItems = 50): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, maxItems)
}
