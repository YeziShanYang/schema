/**
 * Canned integration responses for local test runs. Used only when the
 * worker runs with ALLOW_DEBUG_ROUTES=true (set by `deepspace dev start` and
 * `deepspace test run`, never in production) AND the paper id starts with the
 * fixture prefix. This mocks the external boundary (CloudConvert, Claude,
 * Exa, arXiv) while the action, job, records and UI run for real.
 */

export const FIXTURE_META = {
  version: 'v1',
  title: 'A Fixture Paper on Curvature-Aware Attention',
  authors: ['Test Author', 'Second Author'],
  abstract:
    'We study attention layers whose scores are corrected by a curvature term. This fixture exists for automated tests.',
  primaryCategory: 'cs.LG',
  publishedAt: '2026-11-01T00:00:00Z',
}

export const FIXTURE_PAPER_TEXT = `A Fixture Paper on Curvature-Aware Attention

Abstract
We study attention layers whose scores are corrected by a curvature term.

1 Introduction
Attention layers compute a weighted average of value vectors, where the weights come from a softmax over query-key scores.
Most prior work treats the representation space as flat, which ignores how embeddings bend on a curved manifold.

2 Background
The softmax function turns a vector of real-valued scores into a probability distribution over positions.
We assume the reader knows how gradient descent updates parameters by following the negative gradient of a loss.

3 Method
We add a curvature correction to each attention score, computed from the second fundamental form of the embedding manifold.
The corrected scores are passed through the same softmax, so the layer still outputs a convex combination of values.

4 Experiments
On three benchmarks the curvature correction improves accuracy by a small but consistent margin over standard attention.

5 Conclusion
Curvature-aware attention is a simple drop-in change that respects the geometry of learned representations.

References
[1] A. Vaswani et al. Attention is all you need. 2017.
`

const concepts = {
  main_contribution:
    'Adds a curvature correction from the second fundamental form to attention scores and shows small consistent gains.',
  branches: [
    { key: 'foundations', name: 'Foundations', description: 'Math and ML basics the paper assumes.' },
    { key: 'attention', name: 'Attention', description: 'How attention layers weigh inputs.' },
    { key: 'geometry', name: 'Geometry of representations', description: 'Curvature of embedding manifolds.' },
  ],
  concepts: [
    {
      id: 'c1',
      name: 'Softmax over scores',
      why_needed: 'The method feeds corrected scores through a softmax.',
      section: '2 Background',
      quote: 'The softmax function turns a vector of real-valued scores into a probability distribution over positions.',
      depends_on: [],
      depth: 'working',
      branch_key: 'foundations',
      topic: { key: 'softmax-function' },
    },
    {
      id: 'c2',
      name: 'Attention as a weighted average',
      why_needed: 'The paper modifies attention scores.',
      section: '1 Introduction',
      quote: 'Attention layers compute a weighted average of value vectors, where the weights come from a softmax over query-key scores.',
      depends_on: ['c1'],
      depth: 'deep',
      branch_key: 'attention',
      topic: { key: 'attention-mechanism' },
    },
    {
      id: 'c3',
      name: 'Second fundamental form of an embedding manifold',
      why_needed: 'The correction term is computed from it.',
      section: '3 Method',
      quote: 'We add a curvature correction to each attention score, computed from the second fundamental form of the embedding manifold.',
      depends_on: ['c2', 'c9'],
      depth: 'deep',
      branch_key: 'geometry',
      topic: {
        key: 'fixture-second-fundamental-form',
        name: 'Second fundamental form (fixture)',
        level: 'specialized',
        description: 'How a surface bends inside the space around it.',
        search_query: 'second fundamental form intuition',
      },
    },
    {
      id: 'c4',
      name: 'Invented concept with a made-up quote',
      why_needed: 'Checks that unverified quotes are flagged.',
      section: '4 Experiments',
      quote: 'This sentence does not appear anywhere in the paper text at all, not even close.',
      depends_on: ['c3'],
      depth: 'skim',
      branch_key: 'not-a-branch',
      topic: { key: 'gradient-descent' },
    },
  ],
}

const explain = {
  sections: [
    { heading: '1 Introduction', summary: 'Frames attention as a weighted average and notes that prior work assumes a flat space.', concept_ids: ['c1', 'c2'] },
    { heading: '3 Method', summary: 'Adds a curvature term to each attention score before the softmax.', concept_ids: ['c2', 'c3'] },
    { heading: '4 Experiments', summary: 'Reports small consistent gains on three benchmarks.', concept_ids: ['c4'] },
  ],
  checks: [
    { concept_id: 'c1', question: 'What does softmax output?', choices: ['A probability distribution', 'A single score', 'A gradient', 'A matrix inverse'], answer_index: 0, explanation: 'Softmax normalizes scores into probabilities.' },
    { concept_id: 'c2', question: 'What does an attention layer average?', choices: ['Keys', 'Value vectors', 'Gradients', 'Labels'], answer_index: 1, explanation: 'Weights from the scores average the value vectors.' },
    { concept_id: 'c3', question: 'What does the second fundamental form describe?', choices: ['Training speed', 'Token frequency', 'How a manifold bends in the ambient space', 'Model size'], answer_index: 2, explanation: 'It measures extrinsic curvature.' },
    { concept_id: 'c4', question: 'Which direction does gradient descent move parameters?', choices: ['Along the gradient', 'Randomly', 'Against the gradient', 'Toward zero'], answer_index: 2, explanation: 'It follows the negative gradient.' },
  ],
}

function message(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
}

/** Respond like the real integration would, keyed by endpoint and a stage hint. */
export function fixtureIntegration(endpoint: string, body: Record<string, unknown>, hint?: string): unknown {
  if (endpoint === 'cloudconvert/convert-file') {
    // Fixture ids ending in 9999 behave like a scanned PDF with no text, so the analysis fails.
    return { downloadUrl: String(body.url ?? '').endsWith('9999') ? 'fixture://scanned.txt' : 'fixture://paper.txt' }
  }
  if (endpoint === 'exa/search' && Array.isArray(body.includeDomains) && body.includeDomains.includes('arxiv.org')) {
    return {
      results: [
        { title: 'Fixture survey of attention', url: 'https://arxiv.org/abs/0000.00011', text: 'A survey of attention mechanisms.' },
        { title: 'Fixture tutorial on embeddings', url: 'https://arxiv.org/pdf/0000.00012v2', text: 'A tutorial on embedding geometry.' },
        { title: 'Not an arXiv paper', url: 'https://example.org/blog', text: 'Off-domain result that must be dropped.' },
        { title: 'Fixture advanced paper', url: 'https://arxiv.org/abs/0000.00013', text: 'Advanced follow-up work.' },
      ],
    }
  }
  if (endpoint === 'exa/search') {
    const q = String(body.query ?? 'topic')
    return {
      results: [
        { title: `${q}: a gentle introduction`, url: `https://example.org/learn/${encodeURIComponent(q)}`, text: `A beginner tutorial on ${q}.` },
        { title: `${q} lecture notes`, url: `https://example.edu/notes/${encodeURIComponent(q)}.pdf`, text: `Lecture notes covering ${q}.` },
      ],
    }
  }
  if (endpoint === 'anthropic/chat-completion') {
    if (hint === 'concepts') return message(JSON.stringify(concepts))
    if (hint === 'explain') return message(JSON.stringify(explain))
    if (hint === 'recommend') {
      return message(JSON.stringify({ picks: [{ n: 1, reason: 'A broad survey to start with.' }, { n: 2, reason: 'Builds geometric intuition.' }, { n: 9, reason: 'Invented result number that must be ignored.' }] }))
    }
    if (hint === 'explain-concept') {
      return message('Fixture explanation.\n\n### Worked example\nScores [1, 2] become softmax [0.27, 0.73].')
    }
    if (hint === 'resources') {
      // Pick the first candidate for every topic named in the prompt.
      const user = String((body.messages as { content: string }[])?.[0]?.content ?? '')
      const picks = [...user.matchAll(/TOPIC (\S+)\n[\s\S]*?\n  1\. .*?\n     (\S+)/g)].map((m) => ({
        key: m[1],
        resources: [{ url: m[2], why: 'Covers the basics step by step.' }],
      }))
      return message(JSON.stringify({ topics: picks }))
    }
  }
  throw new Error(`No fixture for ${endpoint} (${hint ?? 'no hint'})`)
}

export function fixtureText(url: string): string {
  if (url === 'fixture://paper.txt') return FIXTURE_PAPER_TEXT
  if (url === 'fixture://scanned.txt') return '   \f  '
  throw new Error(`No fixture text for ${url}`)
}
