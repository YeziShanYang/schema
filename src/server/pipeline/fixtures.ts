/**
 * Canned integration responses for local test runs. Used only when the
 * worker runs with ALLOW_DEBUG_ROUTES=true (set by `deepspace dev start` and
 * `deepspace test run`, never in production) AND the paper id starts with the
 * fixture prefix. This mocks the external boundary (arXiv HTML, CloudConvert,
 * Claude, Exa, arXiv metadata) while the action, job, records and UI run for real.
 *
 * Fixture ids by their last two digits:
 * - 77: no HTML, and the PDF conversion fails before anything is billed.
 * - 99: no HTML, and the PDF has no text (a scanned image), so the analysis fails.
 * - 66: no HTML; the PDF converts, so the paper is analyzed from the PDF text.
 * - 44: analyzed from the HTML fixture, under a long one-line title (fixtureMeta).
 * - anything else: analyzed from the HTML fixture below.
 *
 * What the concept list exercises (see stepConcepts and its rules):
 * - c4 proposes the starter topic gradient-descent, which shares no content
 *   word with its name, so the server gives it a topic of its own.
 * - c6's first quote is display math and c8's first quote ends in a lead-in,
 *   so both fall back to their second quote. c7's first quote is c3's, so it
 *   takes its second. c4's only quote is not in the paper, and no sentence
 *   names it, so it has none.
 * - c5's only quote is c1's, so the server finds c5's quote in the text: the
 *   first sentence that names "gradient descent" and passes the rules.
 * - c6's quote has inline math, so on the HTML path it renders with KaTeX.
 * - "deployment" holds only c9, so it merges into geometry, where c9's
 *   prerequisites are. c4 and c8 name branches that do not exist, so they
 *   form "Other concepts".
 * - c3 depends on c99, which does not exist and is dropped.
 * The overview's s5 and c9's plain role are judged unsupported by the verify
 * fixture and dropped, and so is s3's technical line.
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

/** The title fixture ids ending in 44 get, long enough to overflow a phone screen on one line. */
export const LONG_FIXTURE_TITLE =
  'A Fixture Paper on Curvature-Aware Attention with a Deliberately Long Title That Runs Well Past the Width of Any Phone Screen'

/** arXiv metadata for a fixture id. */
export function fixtureMeta(id: string): typeof FIXTURE_META {
  return id.endsWith('44') ? { ...FIXTURE_META, title: LONG_FIXTURE_TITLE } : FIXTURE_META
}

/** Related-work filler, so the HTML text clears the minimum length the server accepts. */
const RELATED = Array.from(
  { length: 40 },
  (_, i) => `Related study ${i + 1} measured attention on benchmark ${i + 1} and reported a change of ${(i % 7) / 10} points in accuracy.`,
)

/** The PDF converted to text: what CloudConvert returns for fixture ids ending in 66. Math is damaged, as in real PDFs. */
export const FIXTURE_PAPER_TEXT = `A Fixture Paper on Curvature-Aware Attention

Abstract
We study attention layers whose scores are corrected by a curvature term.

1 Introduction
Attention layers compute a weighted average of value vectors, where the weights come from a softmax over query-key scores.
Most prior work treats the representation space as flat, which ignores how embeddings bend on a curved manifold.

2 Background
The softmax function turns a vector of real-valued scores into a probability distribution over positions.
We assume the reader knows how gradient descent updates parameters by following the negative gradient of a loss.
Each score is the dot product of a query and a key, divided by dk to keep its scale stable.
sij = qi · kj / dk (1)

3 Method
We add a curvature correction to each attention score, computed from the second fundamental form of the embedding manifold.
The corrected scores are passed through the same softmax, so the layer still outputs a convex combination of values.
The layer output is computed as follows:
oi = Σj softmax(sij + κij) vj (2)

4 Experiments
On three benchmarks the curvature correction improves accuracy by a small but consistent margin over standard attention.

5 Conclusion
Curvature-aware attention is a simple drop-in change that respects the geometry of learned representations.

References
[1] A. Vaswani et al. Attention is all you need. 2017.
`

const mathEl = (tex: string, display: 'inline' | 'block') =>
  `<math class="ltx_Math" alttext="${tex}" display="${display}"><semantics><mi>x</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`

/** The arXiv HTML page (LaTeXML output, trimmed): what https://arxiv.org/html/<fixture id> returns. */
export const FIXTURE_PAPER_HTML = `<!DOCTYPE html>
<html lang="en"><head><title>A Fixture Paper on Curvature-Aware Attention</title>
<script>var shown = "<p>Script text is not paper text.</p>";</script>
<style>.ltx_p { color: black; }</style></head>
<body>
<header class="site-header">arXiv chrome that is not paper text.</header>
<nav class="ltx_page_navbar"><nav class="ltx_TOC">Table of contents</nav></nav>
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">A Fixture Paper on Curvature-Aware Attention</h1>
<div class="ltx_authors"><span class="ltx_creator ltx_role_author"><span class="ltx_personname">Test Author</span></span></div>
<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6>
<p class="ltx_p">We study attention layers whose scores are corrected by a curvature term.</p></div>
<section id="S1" class="ltx_section">
<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Introduction</h2>
<div class="ltx_para"><p class="ltx_p">Attention layers compute a weighted average of value vectors, where the weights come from a softmax over query-key scores.<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content">A footnote that is not part of the sentence.</span></span></span>
Most prior work treats the representation space as flat, which ignores how embeddings bend on a curved manifold.</p></div>
</section>
<section id="S2" class="ltx_section">
<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">2 </span>Background</h2>
<div class="ltx_para"><p class="ltx_p">The softmax function turns a vector of real-valued scores into a probability distribution over positions.
We assume the reader knows how gradient descent updates parameters by following the negative gradient of a loss.
Each score is the dot product of a query and a key, divided by ${mathEl('\\sqrt{d_{k}}', 'inline')} to keep its scale stable.</p></div>
<table id="S2.E1" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row">
<td class="ltx_eqn_cell ltx_align_center">${mathEl('s_{ij}=\\frac{q_{i}\\cdot k_{j}}{\\sqrt{d_{k}}}', 'block')}</td>
<td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(1)</span></td></tr></tbody></table>
<div class="ltx_para"><p class="ltx_p">${RELATED.join(' ')}</p></div>
</section>
<section id="S3" class="ltx_section">
<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">3 </span>Method</h2>
<div class="ltx_para"><p class="ltx_p">We add a curvature correction to each attention score, computed from the second fundamental form of the embedding manifold.
The corrected scores are passed through the same softmax, so the layer still outputs a convex combination of values.
The layer output is computed as follows:</p></div>
<table id="S3.E2" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row">
<td class="ltx_eqn_cell ltx_align_center">${mathEl('o_{i}=\\sum_{j}\\operatorname{softmax}(s_{ij}+\\kappa_{ij})\\,v_{j}', 'block')}</td>
<td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(2)</span></td></tr></tbody></table>
</section>
<section id="S4" class="ltx_section">
<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">4 </span>Experiments</h2>
<div class="ltx_para"><p class="ltx_p">On three benchmarks the curvature correction improves accuracy by a small but consistent margin over standard attention.</p></div>
<figure class="ltx_table"><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1: </span>Accuracy on three benchmarks.</figcaption>
<table class="ltx_tabular"><tr><th>Model</th><th>Accuracy</th></tr><tr><td>Attention</td><td>81.2</td></tr><tr><td>Curvature-aware</td><td>82.0</td></tr></table></figure>
</section>
<section id="S5" class="ltx_section">
<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">5 </span>Conclusion</h2>
<div class="ltx_para"><p class="ltx_p">Curvature-aware attention is a simple drop-in change that respects the geometry of learned representations.</p></div>
</section>
<section id="bib" class="ltx_bibliography"><h2 class="ltx_title ltx_title_bibliography">References</h2>
<ul class="ltx_biblist"><li class="ltx_bibitem">A. Vaswani et al. Attention is all you need. 2017.</li></ul></section>
<section id="A1" class="ltx_appendix"><h2 class="ltx_title ltx_title_appendix">Appendix A Proofs</h2>
<p class="ltx_p">Appendix text that is not part of the main argument.</p></section>
</article>
<footer>arXiv footer</footer>
</body></html>`

const topic = (key: string, name: string, level: string, description: string) => ({
  key,
  name,
  level,
  description,
  search_query: `${name} explained for beginners`,
})

const concepts = {
  main_contribution:
    'Adds a curvature correction from the second fundamental form to attention scores and shows small consistent gains.',
  branches: [
    { key: 'foundations', name: 'Foundations', description: 'Math and ML basics the paper assumes.' },
    { key: 'attention', name: 'Attention', description: 'How attention layers weigh inputs.' },
    { key: 'geometry', name: 'Geometry of representations', description: 'Curvature of embedding manifolds.' },
    { key: 'deployment', name: 'Deployment', description: 'Using the layer in existing models.' },
  ],
  concepts: [
    {
      id: 'c1',
      name: 'Softmax over scores',
      why_needed: 'The method feeds corrected scores through a softmax.',
      section: '2 Background',
      quotes: ['The softmax function turns a vector of real-valued scores into a probability distribution over positions.'],
      depends_on: [],
      depth: 'working',
      branch_key: 'foundations',
      topic: topic('softmax-function', 'Softmax function', 'foundation', 'Turning a vector of scores into a probability distribution.'),
    },
    {
      id: 'c5',
      name: 'Gradient descent',
      why_needed: 'The layer is trained like any other by gradient descent.',
      section: '2 Background',
      quotes: ['The softmax function turns a vector of real-valued scores into a probability distribution over positions.'],
      depends_on: [],
      depth: 'skim',
      branch_key: 'foundations',
      topic: topic('gradient-descent', 'Gradient descent', 'foundation', 'Iteratively minimizing a loss by following the negative gradient.'),
    },
    {
      id: 'c2',
      name: 'Attention as a weighted average',
      why_needed: 'The paper modifies attention scores.',
      section: '1 Introduction',
      quotes: ['Attention layers compute a weighted average of value vectors, where the weights come from a softmax over query-key scores.'],
      depends_on: ['c1'],
      depth: 'deep',
      branch_key: 'attention',
      topic: topic('attention-mechanism', 'Attention mechanism', 'core', 'Weighting inputs by learned relevance.'),
    },
    {
      id: 'c6',
      name: 'Scaled query-key scores',
      why_needed: 'The correction is added to scores scaled by \\(\\sqrt{d_k}\\).',
      section: '2 Background',
      quotes: [
        '\\[s_{ij}=\\frac{q_{i}\\cdot k_{j}}{\\sqrt{d_{k}}}\\]',
        'Each score is the dot product of a query and a key, divided by \\(\\sqrt{d_{k}}\\) to keep its scale stable.',
      ],
      depends_on: ['c1'],
      depth: 'working',
      branch_key: 'attention',
      topic: topic('scaled-dot-product-scores', 'Scaled dot-product scores', 'core', 'Query-key dot products divided by the square root of the key dimension.'),
    },
    {
      id: 'c3',
      name: 'Second fundamental form of an embedding manifold',
      why_needed: 'The correction term is computed from it.',
      section: '3 Method',
      quotes: ['We add a curvature correction to each attention score, computed from the second fundamental form of the embedding manifold.'],
      depends_on: ['c2', 'c99'],
      depth: 'deep',
      branch_key: 'geometry',
      topic: topic('fixture-second-fundamental-form', 'Second fundamental form (fixture)', 'specialized', 'How a surface bends inside the space around it.'),
    },
    {
      id: 'c7',
      name: 'Curved embedding manifolds',
      why_needed: 'The paper treats embeddings as points on a curved surface.',
      section: '1 Introduction',
      quotes: [
        'We add a curvature correction to each attention score, computed from the second fundamental form of the embedding manifold.',
        'Most prior work treats the representation space as flat, which ignores how embeddings bend on a curved manifold.',
      ],
      depends_on: ['c2'],
      depth: 'working',
      branch_key: 'geometry',
      topic: topic('curved-embedding-manifolds', 'Curved embedding manifolds', 'core', 'Representation spaces that bend instead of being flat.'),
    },
    {
      id: 'c9',
      name: 'Drop-in layer replacement',
      why_needed: 'The paper argues the layer can replace standard attention without other changes.',
      section: '5 Conclusion',
      quotes: ['Curvature-aware attention is a simple drop-in change that respects the geometry of learned representations.'],
      depends_on: ['c3', 'c7'],
      depth: 'skim',
      branch_key: 'deployment',
      topic: topic('drop-in-layer-replacement', 'Drop-in layer replacement', 'core', 'Swapping one network layer for another with the same interface.'),
    },
    {
      id: 'c4',
      name: 'Invented concept with a made-up quote',
      why_needed: 'Checks that unverified quotes are flagged.',
      section: '4 Experiments',
      quotes: ['This sentence does not appear anywhere in the paper text at all, not even close.'],
      depends_on: ['c3'],
      depth: 'skim',
      branch_key: 'not-a-branch',
      topic: topic('gradient-descent', 'Gradient descent', 'foundation', 'Iteratively minimizing a loss by following the negative gradient.'),
    },
    {
      id: 'c8',
      name: 'Consistent benchmark gains',
      why_needed: 'The experiments report the size of the improvement.',
      section: '4 Experiments',
      quotes: [
        'The layer output is computed as follows:',
        'On three benchmarks the curvature correction improves accuracy by a small but consistent margin over standard attention.',
      ],
      depends_on: ['c6'],
      depth: 'skim',
      branch_key: 'results',
      topic: topic('fixture-benchmark-gains', 'Benchmark gains (fixture)', 'specialized', 'Reading a small but consistent improvement across benchmarks.'),
    },
  ],
}

const explain = {
  sections: [
    { heading: '1 Introduction', summary: 'Frames attention as a weighted average and notes that prior work assumes a flat space.', concept_ids: ['c1', 'c2', 'c7'] },
    { heading: '3 Method', summary: 'Adds a curvature term to each attention score before the softmax.', concept_ids: ['c2', 'c3', 'c6'] },
    { heading: '4 Experiments', summary: 'Reports small consistent gains on three benchmarks.', concept_ids: ['c4', 'c8'] },
  ],
}

const overview = {
  plain: 'Attention lets a model decide which words matter most. This paper bends that choice to follow the shape of the data, which helps a little on every test.',
  story: [
    { text: 'Models read a sentence by deciding how much each word should count.', technical: 'Here the paper uses a softmax over scores to turn them into weights.', concept_keys: ['c1'] },
    { text: 'Those weights blend the words into one summary.', technical: 'Here the paper uses attention as a weighted average of value vectors.', concept_keys: ['c2', 'c1'] },
    {
      text: 'Each weight starts from a score that compares two words, kept at a steady size.',
      technical: 'Here the paper uses scores divided by \\(d_k\\) twice to keep them small.',
      concept_keys: ['c6', 'c2'],
    },
    { text: 'The authors adjust each weight using how curved the data is.', technical: 'Here the paper uses the second fundamental form to correct attention scores.', concept_keys: ['c3', 'c7', 'not-a-concept'] },
    { text: 'This makes every large language model twice as fast.', technical: 'Here the paper uses the drop-in layer to speed up training.', concept_keys: ['c9'] },
  ],
  roles: [
    { key: 'c1', plain_role: 'It turns raw scores into weights that add up to one.' },
    { key: 'c5', plain_role: 'It is how the new layer is trained.' },
    { key: 'c2', plain_role: 'It is the step the paper changes.' },
    { key: 'c6', plain_role: 'These are the scores the correction is added to.' },
    { key: 'c3', plain_role: 'It measures the curve the correction follows.' },
    { key: 'c7', plain_role: 'It is the picture of the data the paper starts from.' },
    { key: 'c9', plain_role: 'It makes every model twice as fast.' },
    { key: 'c4', plain_role: 'It checks that made-up quotes are caught.' },
    { key: 'c8', plain_role: 'It is how big the improvement is.' },
    { key: 'c99', plain_role: 'Unknown key that must be dropped.' },
  ],
}

/** The verify stage's judgments of the overview above. */
const verify = {
  plain_supported: true,
  story: [
    { id: 's1', text_supported: true, jargon: false, technical_supported: true },
    { id: 's2', text_supported: true, jargon: false, technical_supported: true },
    { id: 's3', text_supported: true, jargon: false, technical_supported: false, note: 'The paper divides by the square root of d_k once.' },
    { id: 's4', text_supported: true, jargon: false, technical_supported: true },
    { id: 's5', text_supported: false, jargon: false, technical_supported: false, note: 'The paper reports small accuracy gains, not speed.' },
  ],
  roles: [{ key: 'c9', supported: false, note: 'The paper does not claim a speedup.' }],
}

function message(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
}

/**
 * Fixture ids ending in 55 answer every integration call (and the arXiv HTML
 * fetch) after this delay, so
 * a local run can watch the analysis move through its stages.
 */
export const SLOW_FIXTURE_MS = 4000

export function fixtureDelayMs(arxivId: string): number {
  return arxivId.endsWith('55') ? SLOW_FIXTURE_MS : 0
}

/** Respond like the real integration would, keyed by endpoint and a stage hint. */
export function fixtureIntegration(endpoint: string, body: Record<string, unknown>, hint?: string): unknown {
  if (endpoint === 'cloudconvert/convert-file') {
    // Fixture ids ending in 77 fail the conversion itself, before anything is billed.
    if (String(body.url ?? '').endsWith('77')) throw new Error('Fixture conversion failure')
    // Fixture ids ending in 99 behave like a scanned PDF with no text, so the analysis fails.
    return { downloadUrl: String(body.url ?? '').endsWith('99') ? 'fixture://scanned.txt' : 'fixture://paper.txt' }
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
    if (hint === 'overview') return message(JSON.stringify(overview))
    if (hint === 'verify') return message(JSON.stringify(verify))
    if (hint === 'explain-concept') {
      return message(
        'Fixture explanation. Softmax maps scores to \\(\\sigma(z)_i = e^{z_i} / \\sum_j e^{z_j}\\), and a $5 price stays text.\n\n### Worked example\nScores [1, 2] become softmax [0.27, 0.73]:\n\\[\\frac{e^{2}}{e^{1} + e^{2}} \\approx 0.73\\]',
      )
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

/** The arXiv HTML page for a fixture id: 404 for ids ending in 77, 99 or 66, which take the PDF path. */
export function fixtureHtml(url: string): { status: number; text: string } {
  return /(?:77|99|66)\/?$/.test(url) ? { status: 404, text: 'Not found' } : { status: 200, text: FIXTURE_PAPER_HTML }
}
