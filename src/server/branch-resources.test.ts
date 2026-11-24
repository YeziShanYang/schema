import { describe, expect, it } from 'vitest'
import { fallbackResources, findResources, skipsLinks } from './branch-resources'
import type { PipelineClient } from './pipeline/client'

const candidates = [
  { title: 'A number puzzle for kids', url: 'https://blog.example/puzzle', snippet: '' },
  { title: 'Identification and guessing probability, lecture 4', url: 'https://notes.example/l4', snippet: '' },
]

function client(pick: unknown): PipelineClient {
  return {
    fixtures: true,
    fetchText: async () => '',
    fetchPage: async () => ({ status: 404, text: '' }),
    call: async (endpoint) => {
      if (endpoint === 'exa/search') return { results: candidates.map((c) => ({ title: c.title, url: c.url, text: '' })) }
      if (pick instanceof Error) throw pick
      return { content: [{ type: 'text', text: JSON.stringify(pick) }], stop_reason: 'end_turn' }
    },
  }
}
const topic = { key: 'guessing-probability', name: 'Guessing probability and identification', description: '', searchQuery: 'q' }

describe('link picker', () => {
  it('stores an empty list when the pick call finds no fit, instead of raw results', async () => {
    const { picks, charged } = await findResources(client({ topics: [{ key: topic.key, resources: [] }] }), [topic])
    expect(picks[topic.key]).toEqual([])
    expect(charged).toBe(true)
  })

  it('treats a skipped topic or invented URLs as no fit', async () => {
    expect((await findResources(client({ topics: [] }), [topic])).picks[topic.key]).toEqual([])
    const invented = { topics: [{ key: topic.key, resources: [{ url: 'https://made.up/x', why: 'w' }] }] }
    expect((await findResources(client(invented), [topic])).picks[topic.key]).toEqual([])
  })

  it('falls back to raw results only when the pick call errors, and only to titles sharing a content word', async () => {
    const { picks } = await findResources(client(new Error('model down')), [topic])
    expect(picks[topic.key]).toEqual([{ title: candidates[1].title, url: candidates[1].url, why: '' }])
    expect(fallbackResources('Softmax function', candidates)).toEqual([])
  })
})

describe('skipsLinks', () => {
  it('skips the search only for a specialized paper topic that one paper uses', () => {
    expect(skipsLinks({ level: 'specialized', origin: 'paper' }, 1)).toBe(true)
    expect(skipsLinks({ level: 'specialized', origin: 'paper' }, 2)).toBe(false)
    expect(skipsLinks({ level: 'core', origin: 'paper' }, 1)).toBe(false)
    expect(skipsLinks({ level: 'specialized', origin: 'starter' }, 1)).toBe(false)
  })
})
