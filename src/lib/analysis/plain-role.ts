/**
 * Whether a concept card shows its plain role ("Where it fits") above the
 * why-needed line. The overview call writes the role, and it often says
 * again what why-needed already says: "Input and output tokens are
 * converted into learned vectors before any attention is applied" above
 * "Input and output tokens are first converted into learned dense vectors
 * before any attention is applied". A role restates why-needed when more
 * than half of its content words (topics.contentWords, math left out)
 * appear in why-needed. At exactly half, roles start to add something of
 * their own (what a comparison shows, what a split lets the method keep),
 * so those stay.
 */

import { contentWords } from '../knowledge/topics'

/** A role is hidden when the share of its content words found in why-needed is above this. */
export const ROLE_RESTATES_ABOVE = 0.5

function words(text: string): Set<string> {
  return contentWords(text.replace(/\\\([\s\S]*?\\\)/g, ' ').replace(/\\\[[\s\S]*?\\\]/g, ' ').replace(/\$[^$]+\$/g, ' '))
}

/** The share of the role's content words that also appear in why-needed, 0 to 1; 0 for a role with none. */
export function roleOverlap(role: string, whyNeeded: string): number {
  const own = words(role)
  if (!own.size) return 0
  const why = words(whyNeeded)
  let shared = 0
  for (const w of own) if (why.has(w)) shared++
  return shared / own.size
}

/** True when the role mostly says again what the why-needed line says. */
export function roleRestatesWhy(role: string, whyNeeded: string): boolean {
  return roleOverlap(role, whyNeeded) > ROLE_RESTATES_ABOVE
}
