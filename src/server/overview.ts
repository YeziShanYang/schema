/**
 * The paper overview: a plain-language summary, the paper's argument as a
 * short story whose steps name the concepts they rely on, and a one-line
 * plain role per concept. One Haiku call. The analyze job runs it as the
 * `overview` stage; ensureOverview runs it once for papers analyzed before
 * the stage existed.
 */

import { appFiles } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Envelope, PaperData, PaperOverview, StoryItem } from '../types'
import { asString, asStringArray } from '../lib/json'
import { callModelJson } from './pipeline/llm'
import type { PipelineClient } from './pipeline/client'
import { OVERVIEW_SYSTEM, overviewUser } from './pipeline/prompts'

/** About the first 12,000 characters of the main text go into the prompt. */
export const OVERVIEW_TEXT_CHARS = 12_000
const MAX_STORY_ITEMS = 8
const MAX_KEYS_PER_ITEM = 4
const MAX_ROLE_CHARS = 200

export interface OverviewConcept {
  key: string
  name: string
  whyNeeded: string
  section: string
  order: number
}

export interface ParsedOverview {
  overview: PaperOverview
  /** Concept key to its plain role. */
  roles: Record<string, string>
}

/**
 * Keeps what the model returned that fits: unknown concept keys are dropped,
 * the story is capped at 8 items, and concepts no story item uses are listed
 * as "also needed" in concept order. Throws when nothing usable came back.
 */
export function parseOverview(json: Record<string, unknown>, concepts: OverviewConcept[], now = Date.now()): ParsedOverview {
  const known = new Set(concepts.map((c) => c.key))
  const plain = asString(json.plain, 800)
  const story: StoryItem[] = []
  const items = Array.isArray(json.story) ? json.story : []
  for (const raw of items) {
    if (story.length >= MAX_STORY_ITEMS) break
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const text = asString(o.text, 300)
    if (!text) continue
    const conceptKeys = [...new Set(asStringArray(o.concept_keys, 20).filter((k) => known.has(k)))].slice(0, MAX_KEYS_PER_ITEM)
    story.push({ id: `s${story.length + 1}`, text, technical: asString(o.technical, 400), conceptKeys })
  }
  if (!plain || story.length < 2) throw new Error('The model did not return a usable overview.')

  const used = new Set(story.flatMap((s) => s.conceptKeys))
  const alsoNeeded = [...concepts].sort((a, b) => a.order - b.order).map((c) => c.key).filter((k) => !used.has(k))

  const roles: Record<string, string> = {}
  const list = Array.isArray(json.roles) ? json.roles : []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const key = asString(o.key, 20)
    const role = asString(o.plain_role, MAX_ROLE_CHARS)
    if (known.has(key) && role && !roles[key]) roles[key] = role
  }
  return { overview: { plain, story, alsoNeeded, generatedAt: now }, roles }
}

export async function generateOverview(
  client: PipelineClient,
  paper: Pick<PaperData, 'title' | 'abstract' | 'mainContribution'>,
  text: string,
  concepts: OverviewConcept[],
): Promise<ParsedOverview> {
  const ordered = [...concepts].sort((a, b) => a.order - b.order)
  const json = await callModelJson(client, {
    system: OVERVIEW_SYSTEM,
    user: overviewUser({
      title: paper.title,
      abstract: paper.abstract,
      mainContribution: paper.mainContribution,
      text: text.slice(0, OVERVIEW_TEXT_CHARS),
      concepts: ordered.map((c) => ({ key: c.key, name: c.name, whyNeeded: c.whyNeeded, section: c.section })),
    }),
    maxTokens: 8000, // thinking counts against this
    hint: 'overview',
  })
  return parseOverview(json, ordered)
}

/** The stored paper text, or '' when there is none (the abstract still gives the model enough). */
export async function storedPaperText(env: Env, paper: Envelope<PaperData>, fixtures: boolean): Promise<string> {
  if (!paper.data.textKey || fixtures) return ''
  try {
    const res = await appFiles(env, { scope: 'app', userId: env.OWNER_USER_ID }).download(paper.data.textKey)
    return (await res.text()).slice(0, OVERVIEW_TEXT_CHARS)
  } catch {
    return ''
  }
}
