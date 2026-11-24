/**
 * The `verify` stage: one Haiku call checks the overview against the paper
 * (abstract, the start of the text, and each concept's passage) and judges
 * every plain sentence, technical line and plain role. This module turns
 * that verdict into what is kept:
 * - an unsupported technical line is dropped (the step keeps its plain sentence),
 * - an unsupported role is dropped (the card hides "Where it fits"),
 * - an unsupported story sentence is dropped, as long as at least 4 sentences
 *   survive.
 * Jargon is reported, never dropped: the judge flags everyday technical words
 * ("GPUs", "projections"), and dropping from the end of the story cut off its
 * conclusion. The flags are logged and go to a rewrite as feedback.
 * When fewer than 4 sentences would survive, or the summary itself is
 * unsupported, the overview is written once more with the problems as feedback
 * and checked again. On that final check the story keeps at least 4 sentences.
 */

import type { PaperOverview, StoryItem } from '../../types'
import { asString } from '../../lib/json'

export const MIN_STORY_ITEMS = 4
/** The verifier sees the same start of the text the overview was written from. */
export const VERIFY_TEXT_CHARS = 12_000

interface StoryVerdict {
  textSupported: boolean
  jargon: boolean
  technicalSupported: boolean
  note: string
}

export interface OverviewVerdict {
  plainSupported: boolean
  plainNote: string
  story: Map<string, StoryVerdict>
  roles: Map<string, { supported: boolean; note: string }>
}

/** Reads the model's verdict. Anything missing counts as passing, so a short answer never drops content by itself. */
export function parseVerdict(json: Record<string, unknown>): OverviewVerdict {
  const story = new Map<string, StoryVerdict>()
  for (const raw of Array.isArray(json.story) ? json.story : []) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const id = asString(o.id, 20)
    if (!id) continue
    story.set(id, {
      textSupported: o.text_supported !== false,
      jargon: o.jargon === true,
      technicalSupported: o.technical_supported !== false,
      note: asString(o.note, 300),
    })
  }
  const roles = new Map<string, { supported: boolean; note: string }>()
  for (const raw of Array.isArray(json.roles) ? json.roles : []) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const key = asString(o.key, 20)
    if (key) roles.set(key, { supported: o.supported !== false, note: asString(o.note, 300) })
  }
  return { plainSupported: json.plain_supported !== false, plainNote: asString(json.plain_note, 300), story, roles }
}

export interface VerifyOutcome {
  /** The overview to store; null when it should be written again. */
  overview: PaperOverview | null
  regenerate: boolean
  /** Concept keys whose plain role is dropped. */
  droppedRoles: string[]
  droppedStory: number
  droppedTechnical: number
  /** What was wrong, as feedback for the rewrite and for the log. */
  problems: string[]
}

export function applyVerdict(
  overview: PaperOverview,
  verdict: OverviewVerdict,
  conceptOrder: string[],
  opts: { final: boolean },
): VerifyOutcome {
  const problems: string[] = []
  if (!verdict.plainSupported) problems.push(`Summary: ${verdict.plainNote || 'not supported by the paper.'}`)

  const failing = (s: StoryItem) => verdict.story.get(s.id)?.textSupported === false
  for (const s of overview.story) {
    const v = verdict.story.get(s.id)
    if (!v) continue
    if (!v.textSupported) problems.push(`"${s.text}": ${v.note || 'not supported by the paper.'}`)
    else if (v.jargon) problems.push(`"${s.text}": uses a term without saying what it means${v.note ? ` (${v.note})` : ''}.`)
    if (!v.technicalSupported && s.technical) problems.push(`Technical line "${s.technical}": ${v.note || 'not supported by the paper.'}`)
  }
  const droppedRoles = [...verdict.roles].filter(([, r]) => !r.supported).map(([k]) => k)

  const survivors = overview.story.filter((s) => !failing(s))
  const enough = survivors.length >= Math.min(MIN_STORY_ITEMS, overview.story.length)
  if (!opts.final && (!enough || !verdict.plainSupported)) {
    return { overview: null, regenerate: true, droppedRoles, droppedStory: 0, droppedTechnical: 0, problems }
  }

  let kept = survivors
  if (!enough) {
    // Final check: keep at least MIN_STORY_ITEMS, dropping unsupported sentences from the end.
    kept = [...overview.story]
    for (const s of [...kept].reverse()) if (kept.length > MIN_STORY_ITEMS && failing(s)) kept = kept.filter((k) => k !== s)
  }

  let droppedTechnical = 0
  const story = kept.map((s) => {
    const v = verdict.story.get(s.id)
    if (v && !v.technicalSupported && s.technical) {
      droppedTechnical++
      return { ...s, technical: '' }
    }
    return s
  })
  const used = new Set(story.flatMap((s) => s.conceptKeys))
  return {
    overview: { ...overview, story, alsoNeeded: conceptOrder.filter((k) => !used.has(k)) },
    regenerate: false,
    droppedRoles,
    droppedStory: overview.story.length - story.length,
    droppedTechnical,
    problems,
  }
}

/** Right after a term: an apposition, a parenthesis, a dash or colon, or a defining verb. */
const GLOSS_AFTER = /^\s*(?:[,(:—–]|-\s|which\b|that is\b|meaning\b|means\b|is an?\b|are\b|refers? to\b|i\.e\.)/i
/** Right before a term: "called", "known as", "named". */
const GLOSS_BEFORE = /\b(?:called|known as|named)\s*$/i

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Concept names that appear in a story sentence with no sign of being
 * explained where they appear. Logged, not enforced: the verify call judges jargon.
 */
export function unglossedNames(text: string, names: string[]): string[] {
  return names.filter((name) => {
    const n = name.trim().toLowerCase()
    if (n.length < 4) return false
    const stem = n.length > 3 && n.endsWith('s') ? n.slice(0, -1) : n
    const re = new RegExp(`\\b${escapeRegExp(stem)}(?:e?s)?\\b`, 'gi')
    let m: RegExpExecArray | null
    let used = false
    while ((m = re.exec(text)) !== null) {
      used = true
      const after = text.slice(m.index + m[0].length)
      const before = text.slice(0, m.index)
      if (GLOSS_AFTER.test(after) || GLOSS_BEFORE.test(before)) return false
    }
    return used
  })
}
