import { describe, expect, it } from 'vitest'
import type { PaperOverview } from '../../types'
import { applyVerdict, parseVerdict, unglossedNames } from './verify'
import { fixtureIntegration } from './fixtures'
import { findMessage } from './llm'
import { extractJsonObject } from '../../lib/json'

const story = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, text: `Step ${i + 1}.`, technical: `Here the paper uses c${i + 1}.`, conceptKeys: [`c${i + 1}`] }))
const overview = (n: number): PaperOverview => ({ plain: 'Summary.', story: story(n), alsoNeeded: [], generatedAt: 1 })
const order = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']

const verdict = (story: Record<string, unknown>[], extra: Record<string, unknown> = {}) => parseVerdict({ plain_supported: true, story, roles: [], ...extra })

describe('applyVerdict', () => {
  it('drops unsupported sentences and technical lines while 4 or more sentences remain, and only reports jargon', () => {
    const out = applyVerdict(
      overview(6),
      verdict([
        { id: 's2', text_supported: false, note: 'Wrong cause.' },
        { id: 's3', text_supported: true, jargon: true },
        { id: 's4', technical_supported: false },
      ]),
      order,
      { final: false },
    )
    expect(out.regenerate).toBe(false)
    expect(out.overview!.story.map((s) => s.id)).toEqual(['s1', 's3', 's4', 's5', 's6'])
    expect(out.overview!.story[2].technical).toBe('')
    expect(out.overview!.alsoNeeded).toEqual(['c2', 'c7'])
    expect([out.droppedStory, out.droppedTechnical]).toEqual([1, 1])
    expect(out.problems[0]).toContain('Wrong cause.')
    expect(out.problems[1]).toContain('uses a term without saying what it means')
  })

  it('asks for one rewrite when fewer than 4 sentences would survive or the summary is unsupported', () => {
    const bad = verdict([{ id: 's1', text_supported: false }, { id: 's2', text_supported: false }])
    expect(applyVerdict(overview(5), bad, order, { final: false })).toMatchObject({ overview: null, regenerate: true })
    // Jargon alone never asks for a rewrite, however many sentences it flags.
    const wordy = verdict([1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, jargon: true })))
    const kept = applyVerdict(overview(5), wordy, order, { final: false })
    expect(kept.regenerate).toBe(false)
    expect(kept.overview!.story).toHaveLength(5)
    const plain = verdict([], { plain_supported: false, plain_note: 'Overstates the result.' })
    const out = applyVerdict(overview(5), plain, order, { final: false })
    expect(out.regenerate).toBe(true)
    expect(out.problems).toEqual(['Summary: Overstates the result.'])
  })

  it('on the final check keeps 4 sentences, dropping unsupported ones from the end and keeping jargon ones', () => {
    const out = applyVerdict(
      overview(5),
      verdict([{ id: 's1', jargon: true }, { id: 's2', text_supported: false }, { id: 's4', text_supported: false }, { id: 's5', jargon: true }]),
      order,
      { final: true },
    )
    expect(out.regenerate).toBe(false)
    expect(out.overview!.story.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's5'])
  })

  it('drops unsupported plain roles, and counts a missing verdict as passing', () => {
    const out = applyVerdict(overview(4), parseVerdict({ roles: [{ key: 'c2', supported: false }, { key: 'c3', supported: true }] }), order, { final: false })
    expect(out.droppedRoles).toEqual(['c2'])
    expect(out.overview!.story).toHaveLength(4)
  })

  it('applies the fixture verdict: s5 and c9 dropped, s3 loses its technical line', () => {
    const msg = findMessage(fixtureIntegration('anthropic/chat-completion', {}, 'verify'))
    const v = parseVerdict(extractJsonObject(msg!.content!.map((c) => c.text ?? '').join(''))!)
    const out = applyVerdict(overview(5), v, order, { final: false })
    expect(out.overview!.story.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect(out.overview!.story[2].technical).toBe('')
    expect(out.droppedRoles).toEqual(['c9'])
  })
})

describe('unglossedNames', () => {
  it('finds concept names used without a gloss in the same sentence', () => {
    const names = ['Codewords', 'Mutual information']
    expect(unglossedNames('The intersections and supports of codewords determine the answer.', names)).toEqual(['Codewords'])
    expect(unglossedNames('Codewords, strings both sides agree on in advance, determine the answer.', names)).toEqual([])
    expect(unglossedNames('Noise inflates how much one group seems to reveal about another.', names)).toEqual([])
  })
})
