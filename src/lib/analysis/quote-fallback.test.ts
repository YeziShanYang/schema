import { describe, expect, it } from 'vitest'
import { citationCount, findNamedQuote, nameTerms, quoteSearch, refersBack } from './quote-fallback'
import { indexPaperText, normalizeForMatch } from './quotes'

const texts = (name: string, topic = name, others: string[] = [], raw = '') => nameTerms(name, topic, others, raw).map((t) => `${t.kind}:${t.text}`)

describe('names a fallback quote may contain', () => {
  it('tries the name and topic name, then abbreviations, then shorter forms', () => {
    expect(texts('Close Image to Uniform (CIUniform)')).toEqual(['name:Close Image to Uniform (CIUniform)', 'abbreviation:CIUniform', 'short:Close Image to Uniform'])
    expect(texts('Bellman recursion for a priced query', 'Bellman value recursion')).toEqual([
      'name:Bellman recursion for a priced query',
      'name:Bellman value recursion',
      'short:Bellman recursion',
    ])
    expect(texts('Spearman rank correlation and permutation p-values')).toEqual([
      'name:Spearman rank correlation and permutation p-values',
      'short:Spearman rank correlation',
      'short:permutation p-values',
    ])
  })

  it('shares a head noun across "and", and drops the generic head noun of a two-word name only', () => {
    expect(texts('Tangent and normal spaces of a manifold')).toContain('short:Tangent spaces')
    expect(texts('Tangent and normal spaces of a manifold')).not.toContain('short:Tangent')
    expect(texts('Hessian matrix')).toEqual(['name:Hessian matrix', 'short:Hessian'])
    expect(texts('Probability distributions and transition matrices', 'Transition matrices of random maps')).not.toContain('short:transition')
  })

  it('never shortens to a single coordinated word or to another concept\'s name', () => {
    expect(texts('Linear programming and duality')).toEqual(['name:Linear programming and duality', 'short:Linear programming'])
    expect(texts('Vectors and matrices')).toEqual(['name:Vectors and matrices'])
    expect(texts('Decoder-based curvature estimation via automatic differentiation', undefined, ['Automatic differentiation'])).not.toContain(
      'short:automatic differentiation',
    )
  })

  it('reads an abbreviation the paper defines right after the name', () => {
    const raw = 'An AI with a body, also known as an embodied conversational agent (ECA), can face the user.'
    expect(texts('Embodied conversational agent', 'Embodied conversational agent', [], raw)).toContain('abbreviation:ECA')
  })

  it('matches a straight apostrophe in the name to a curly one in the paper, and the reverse', () => {
    const [name, topic] = nameTerms("Hilbert's 10th problem and undecidability", "Hilbert's 10th problem")
    expect(topic.re.test('which is the negative answer to Hilbert’s 10th problem.')).toBe(true)
    expect(name.re.test('Hilbert’s 10th problem and undecidability')).toBe(true)
    expect(nameTerms('Hölder’s inequality', '')[0].re.test("by Hölder's inequality")).toBe(true)
    expect(nameTerms('The “spurious” information', '')[0].re.test('the "spurious" information')).toBe(true)
  })

  it('matches across case, plurals and hyphens, in prose only', () => {
    const [term] = nameTerms('Second fundamental form', '')
    expect(term.re.test('decoder-based second-fundamental-form estimation')).toBe(true)
    expect(term.re.test('the second fundamental forms of both surfaces')).toBe(true)
    expect(nameTerms('Hessian matrix', '')[0].re.test('Hessian matrices')).toBe(true)
  })
})

describe('findNamedQuote', () => {
  // From 2611.29224, whose stored concepts had no quote for the manifold hypothesis.
  const raw =
    'Thus the manifold hypothesis explains the fit. ' +
    'The manifold hypothesis has been studied widely (Fefferman et al., 2016; Bengio et al., 2013) and (Tenenbaum, 2000). ' +
    'Under the manifold hypothesis, \\(M=F(Z)\\) is smooth. ' +
    'We assume the manifold hypothesis (Fefferman et al., 2016), that the embeddings lie near a smooth low-dimensional manifold. ' +
    'The manifold hypothesis is a standard assumption about embeddings that we test against the data.'
  const search = quoteSearch(indexPaperText(raw))

  it('takes the first sentence that names the concept and passes the quote rules', () => {
    const used = new Set<string>()
    expect(findNamedQuote(nameTerms('Manifold hypothesis', 'Manifold hypothesis'), search, used)).toEqual({
      quote: 'We assume the manifold hypothesis (Fefferman et al., 2016), that the embeddings lie near a smooth low-dimensional manifold.',
      term: 'Manifold hypothesis',
      kind: 'name',
    })
    // It is now used, so the next search takes the next passing sentence.
    expect(findNamedQuote(nameTerms('Manifold hypothesis', ''), search, used)?.quote).toBe(
      'The manifold hypothesis is a standard assumption about embeddings that we test against the data.',
    )
    expect(findNamedQuote(nameTerms('Manifold hypothesis', ''), search, used)).toBeNull()
  })

  it('never repeats a quote another concept took', () => {
    const used = new Set([normalizeForMatch('We assume the manifold hypothesis (Fefferman et al., 2016), that the embeddings lie near a smooth low-dimensional manifold.')])
    expect(findNamedQuote(nameTerms('Manifold hypothesis', ''), search, used)?.quote).toMatch(/^The manifold hypothesis is a standard/)
  })

  it('skips sentences that lean on the one before or list citations', () => {
    expect(refersBack('Thus the manifold hypothesis explains the fit.')).toBe(true)
    expect(refersBack('This explains exactly when the older fractional-cover reduction survives a change of protocol.')).toBe(true)
    expect(refersBack('This consists of two linear transformations with a ReLU activation in between.')).toBe(true)
    expect(refersBack('These results show that the manifold hypothesis holds.')).toBe(true)
    expect(refersBack('To this end, we add positional encodings to the input embeddings.')).toBe(true)
    expect(refersBack('For this reason, the manifold hypothesis is tested first.')).toBe(true)
    expect(refersBack('Once this translation is done, the argument in the formal language can be checked.')).toBe(true)
    expect(refersBack('This paper studies the manifold hypothesis.')).toBe(false)
    expect(refersBack('This new work tests the manifold hypothesis.')).toBe(false)
    expect(refersBack('In this section we state the manifold hypothesis.')).toBe(false)
    expect(refersBack('Positional encodings are added to the embeddings.')).toBe(false)
    expect(citationCount('The hypothesis has been studied widely (Fefferman et al., 2016; Bengio et al., 2013) and (Tenenbaum, 2000).')).toBe(2)
    expect(citationCount('a special case introduced in [KLN19], as a bridge')).toBe(1)
  })

  it('skips a line with no sentence-ending punctuation: a heading, title, table row or keyword list', () => {
    // From 2610.08144 and 2611.29224: the keyword list matches the topic name once apostrophes match.
    const raw =
      'Curvature Mismatch and Local Errors in Galaxy Property Estimation\n' +
      'AI Autoformalisation, Navier-Stokes equations, Solvability Complexity Index hierarchy, boundaries of AI, Hilbert’s 10th problem\n' +
      'Model | Hilbert’s 10th problem | 23.75\n' +
      'The negative answer to Hilbert’s 10th problem shows that no algorithm decides every Diophantine equation.'
    const found = findNamedQuote(nameTerms("Hilbert's 10th problem and undecidability", "Hilbert's 10th problem"), quoteSearch(indexPaperText(raw)), new Set())
    expect(found?.quote).toBe('The negative answer to Hilbert’s 10th problem shows that no algorithm decides every Diophantine equation.')
    expect(findNamedQuote(nameTerms('Curvature mismatch and gain', 'Curvature mismatch'), quoteSearch(indexPaperText(raw)), new Set())).toBeNull()
  })
})
