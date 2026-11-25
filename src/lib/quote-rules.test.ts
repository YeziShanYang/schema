import { describe, expect, it } from 'vitest'
import { clippedAt, endsInLeadIn, pickQuote, quotePickOrder, quoteProblem, unbalanced, wordCount } from './quote-rules'
import { exactQuoteSpan, indexPaperText, normalizeForMatch } from './quotes'

const paper = normalizeForMatch(`Theorem 1. With Ak = {A ⊆ V : 1 ≤ |A| ≤ k}, the two optima are
equal. Us = exp{−I(v; s)}, as shown. We compute the dot products of the query with all keys and apply a softmax function to obtain the weights.
The layer output is computed as follows: and so on. Each score is divided by \\(\\sqrt{d_{k}}\\) so that its scale stays stable during training.
The verifier accepts with probability at least two thirds on every yes instance of the problem.`)

describe('quote rules', () => {
  it('rejects equations, display math, fragments, lead-ins and unverified quotes', () => {
    const none = new Set<string>()
    expect(quoteProblem('Theorem 1. With Ak = {A ⊆ V : 1 ≤ |A| ≤ k}, the two optima are', paper, none)).toBe('equation')
    expect(quoteProblem('\\[s_{ij}=\\frac{q_i k_j}{\\sqrt{d_k}}\\] holds for every pair of positions in the input', paper, none)).toBe('display-math')
    expect(quoteProblem('The layer output is computed as follows:', paper, none)).toBe('short')
    expect(quoteProblem('We compute the dot products of the query with all keys and apply the', paper, none)).toBe('lead-in')
    expect(quoteProblem('A sentence of more than eight words that the paper never says anywhere.', paper, none)).toBe('unverified')
    expect(quoteProblem('', paper, none)).toBe('empty')
  })

  it('accepts a verified prose quote with inline math, counting words outside the math', () => {
    const q = 'Each score is divided by \\(\\sqrt{d_{k}}\\) so that its scale stays stable during training.'
    expect(wordCount(q)).toBe(13)
    expect(quoteProblem(q, paper, new Set())).toBeNull()
  })

  it('treats a trailing colon, comma or lead-in word as a lead-in, but not a closing formula', () => {
    expect(endsInLeadIn('the result is computed as follows:')).toBe(true)
    expect(endsInLeadIn('which we write as')).toBe(true)
    expect(endsInLeadIn('the two optima are')).toBe(true)
    expect(endsInLeadIn('before the softmax,')).toBe(true)
    expect(endsInLeadIn('we divide each by \\(\\sqrt{d_k}\\)')).toBe(false)
    expect(endsInLeadIn('the scale stays stable.')).toBe(false)
  })

  it('takes the first passing candidate and never gives two concepts the same quote', () => {
    const used = new Set<string>()
    const good = 'The verifier accepts with probability at least two thirds on every yes instance of the problem.'
    const first = pickQuote(['Us = exp{−I(v; s)}, as shown.', good], paper, used)
    expect(first.quote).toBe(good)
    expect(first.rejected.map((r) => r.problem)).toEqual(['equation'])
    const second = pickQuote([good], paper, used)
    expect(second).toEqual({ quote: '', rejected: [{ quote: good, problem: 'duplicate' }] })
  })
})

describe('quotes in the paper\'s own words', () => {
  const text =
    'We compute the dot products of the query with all keys, divide each by \\(\\sqrt{d_{k}}\\), and apply a softmax function to obtain the weights on the values. ' +
    'For large values of \\(d_{k}\\) the dot products grow large in magnitude, pushing the softmax into regions with tiny gradients.'
  const index = indexPaperText(text)

  it('restores math delimiters the model dropped when copying', () => {
    const copied = 'We compute the dot products of the query with all keys, divide each by \\sqrt{d_{k}}, and apply a softmax function'
    expect(exactQuoteSpan(copied, index)).toBe('We compute the dot products of the query with all keys, divide each by \\(\\sqrt{d_{k}}\\), and apply a softmax function')
  })

  it('widens a span that cuts into a formula to the whole formula, and keeps closing punctuation', () => {
    expect(exactQuoteSpan('values of d_{k} the dot products grow large in magnitude.', index)).toBe('values of \\(d_{k}\\) the dot products grow large in magnitude')
    expect(exactQuoteSpan('pushing the softmax into regions with tiny gradients.', index)).toBe('pushing the softmax into regions with tiny gradients.')
    expect(exactQuoteSpan('A sentence the paper never contains at all.', index)).toBeNull()
  })

  it('stores the exact span when picking, and its normalized form blocks the same passage for another concept', () => {
    const used = new Set<string>()
    const pick = pickQuote(['For large values of d_k the dot products grow large in magnitude, pushing the softmax into regions with tiny gradients.'], index, used)
    expect(pick.quote).toBe('For large values of \\(d_{k}\\) the dot products grow large in magnitude, pushing the softmax into regions with tiny gradients.')
    expect(pickQuote([pick.quote], index, used).rejected[0].problem).toBe('duplicate')
  })

  it('rejects a quote that starts mid-clause', () => {
    expect(quoteProblem('and decreasing it thereafter proportionally to the inverse square root of the step number.', index.norm, new Set())).toBe('fragment')
  })

  it('lets deep concepts pick first, keeping the model order within a depth', () => {
    const order = quotePickOrder([
      { id: 'a', depth: 'working' },
      { id: 'b', depth: 'deep' },
      { id: 'c', depth: 'skim' },
      { id: 'd', depth: 'deep' },
    ])
    expect(order.map((c) => c.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

/**
 * Quotes the review of the deployed app found cut short (RESULTS-v2,
 * pattern 2), each with the paper text around it as the job stored it.
 */
describe('quotes cut before their point', () => {
  const papers = {
    qip: indexPaperText(
      'We begin by considering True Quantified Boolean Formula (TQBF), which is PSPACE-complete [SM73, Theorem 4.3]. In a quantified Boolean formula each quantifier ranges over one variable.\n\n' +
        'The SWAP test was originally proposed for pure states in [BCWdW01] and was later shown to extend to mixed states [KMY09]:\n\n2.3SWAP test for mixed states, adapted from [KMY09, Proposition 9].\n\n' +
        'As in [Wat03, Section 3.1], we use the sum-check protocol for TQBF [She92], which uses a sequence of polynomials \\(P_{0},\\ldots,P_{T}\\) in \\(m^{\\prime}=O(|\\Phi|)\\) variables over a finite field \\(\\mathbb{F}_{q}\\).\n\n' +
        'We say that a quantum circuit \\(Q\\) is a stoquastic verification circuit if \\(Q\\) acts on the registers \\((\\mathsf{W},\\mathsf{A}_{0},\\mathsf{A}_{+})\\), uses only Toffoli, CNOT, and X gates before the final measurement, and then measures the designated output qubit in the Hadamard basis. Here, the workspace register is the prover.',
    ),
    receipts: indexPaperText(
      'Minimizing over both the price and the mixture gives (9). The feasible posterior graphs at fixed price are compact.\n\n' +
        'The vertex-isoperimetric inequality for powers of cliques [11,12] gives \\(\\mu(N(A))\\geq\\mu(A)^{\\log_{3}(3/2)}\\). At \\(|A|\\leq 2^{t}\\), dividing by \\(\\mu(A)\\) gives the bound.\n\n' +
        'For every uniform binary linear event code \\(C\\) of dimension at least two and every expected follow-up budget \\(0\\leq b\\leq 1\\),\n\n\\[M_{b}^{(4)}(C)=\\min\\{1/2+b/3,\;3/4\\}\\]',
    ),
    sensing: indexPaperText(
      'Second, the agent must use this estimate to account for the sensory effects of its own actions (reafference), so that these effects can be distinguished from sensory inputs caused by external events (exafference). In biological systems, these challenges are addressed by forward models that use motor command signals, i.e., corollary discharge or efference copy, to predict the sensory consequences of the agent’s actions [24]. Similarly, engineered systems address these challenges.',
    ),
    transformer: indexPaperText(
      'Since our model contains no recurrence and no convolution, in order for the model to make use of the order of the sequence, we must inject some information about the relative or absolute position of the tokens in the sequence. To this end, we add positional encodings.',
    ),
    markets: indexPaperText(
      'The Chernoff–Stein statement is the continuous-time version of the classical result that the optimal type-II error exponent at fixed type-I error equals the Kullback–Leibler rate (Chernoff, 1952; Cover and Thomas, 2006).\n\n' +
        'Entropy and mutual information appear in models of rational inattention (Sims, 2003; Matějka and McKay, 2015), in theories of information acquisition and portfolio choice.',
    ),
  }
  const pick = (quote: string, paper: keyof typeof papers) => pickQuote([quote], papers[paper], new Set())

  it('carries a quote that stops inside a citation or parenthesis on to its sentence end', () => {
    expect(pick('We begin by considering True Quantified Boolean Formula (TQBF), which is PSPACE-complete [SM73, Theorem 4.3', 'qip')).toMatchObject({
      quote: 'We begin by considering True Quantified Boolean Formula (TQBF), which is PSPACE-complete [SM73, Theorem 4.3].',
      extendedFrom: 'We begin by considering True Quantified Boolean Formula (TQBF), which is PSPACE-complete [SM73, Theorem 4.3',
    })
    expect(pick('Second, the agent must use this estimate to account for the sensory effects of its own actions (reafference', 'sensing').quote).toBe(
      'Second, the agent must use this estimate to account for the sensory effects of its own actions (reafference), so that these effects can be distinguished from sensory inputs caused by external events (exafference).',
    )
  })

  it('rejects a cut quote whose full sentence breaks a rule', () => {
    // The sentence ends in a colon before a proposition.
    expect(pick('The SWAP test was originally proposed for pure states in [BCWdW01] and was later shown to extend to mixed states [KMY09', 'qip').rejected).toEqual([
      { quote: 'The SWAP test was originally proposed for pure states in [BCWdW01] and was later shown to extend to mixed states [KMY09', problem: 'unbalanced' },
    ])
    // The sentence goes on into an equation reference.
    expect(pick('Minimizing over both the price and the mixture gives (9', 'receipts').rejected[0].problem).toBe('unbalanced')
    // The sentence goes on into a formula with "=" in it.
    expect(pick('As in [Wat03, Section 3.1], we use the sum-check protocol for TQBF [She92], which uses a sequence of polynomials', 'qip').rejected[0].problem).toBe('clipped')
    // The sentence goes on into display math.
    expect(pick('For every uniform binary linear event code \\(C\\) of dimension at least two and every expected follow-up budget', 'receipts').quote).toBe('')
  })

  it('carries a quote that stops before its formula on to the sentence end', () => {
    expect(pick('The vertex-isoperimetric inequality for powers of cliques [11,12] gives', 'receipts').quote).toBe(
      'The vertex-isoperimetric inequality for powers of cliques [11,12] gives \\(\\mu(N(A))\\geq\\mu(A)^{\\log_{3}(3/2)}\\).',
    )
    expect(pick('We say that a quantum circuit \\(Q\\) is a stoquastic verification circuit if \\(Q\\) acts on the registers', 'qip').quote).toMatch(
      /acts on the registers \\\(\(\\mathsf\{W\}.*in the Hadamard basis\.$/,
    )
  })

  it('carries a quote that stops before its main clause or verb on to the sentence end', () => {
    expect(pick('Since our model contains no recurrence and no convolution, in order for the model to make use of the order of the sequence', 'transformer').quote).toMatch(
      /, we must inject some information about the relative or absolute position of the tokens in the sequence\.$/,
    )
    expect(pick('The Chernoff–Stein statement is the continuous-time version of the classical result that the optimal type-II error exponent', 'markets').quote).toMatch(
      /at fixed type-I error equals the Kullback–Leibler rate \(Chernoff, 1952; Cover and Thomas, 2006\)\.$/,
    )
  })

  it('keeps a quote that only leaves out a citation, or stops at a clause boundary', () => {
    const efference = 'forward models that use motor command signals, i.e., corollary discharge or efference copy, to predict the sensory consequences of the agent’s actions'
    expect(pick(efference, 'sensing')).toEqual({ quote: efference, rejected: [] })
    const inattention = 'Entropy and mutual information appear in models of rational inattention'
    expect(pick(inattention, 'markets')).toEqual({ quote: inattention, rejected: [] })
  })

  it('finds unbalanced brackets in the prose only, not in math', () => {
    expect(unbalanced('which is PSPACE-complete [SM73, Theorem 4.3')).toBe(true)
    expect(unbalanced('effects of its own actions (reafference')).toBe(true)
    expect(unbalanced('reafference), so that these effects can be distinguished')).toBe(true)
    expect(unbalanced('on the half-open interval \\([0,1)\\) the map is continuous (Lemma 2)')).toBe(false)
  })

  it('treats a closing equation reference as a lead-in, but not a year', () => {
    expect(endsInLeadIn('Minimizing over both the price and the mixture gives (9).')).toBe(true)
    expect(endsInLeadIn('The bound then follows from Eq. (12)')).toBe(true)
    expect(endsInLeadIn('as shown by Smith (2016).')).toBe(false)
  })

  it('checks what follows only with the paper as an index', () => {
    const q = 'The vertex-isoperimetric inequality for powers of cliques [11,12] gives'
    expect(quoteProblem(q, papers.receipts, new Set())).toBe('clipped')
    expect(quoteProblem(q, papers.receipts.norm, new Set())).toBeNull()
    expect(clippedAt('a quote ends here (Fig. 4D). Next.', 'a quote ends here'.length, 'a quote ends here')).toBe(false)
  })
})
