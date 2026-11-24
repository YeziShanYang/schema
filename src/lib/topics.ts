/**
 * Topic vocabulary helpers: key normalization and the starter list every new
 * reader can tick on day one.
 */

import type { TopicLevel } from '../types'

/** Lowercase slug: letters, digits and single hyphens, at most 60 chars. */
export function normalizeTopicKey(raw: string): string {
  if (typeof raw !== 'string') return ''
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

const MATCH_STOP_WORDS = new Set(['a', 'an', 'and', 'as', 'by', 'for', 'from', 'in', 'its', 'of', 'on', 'the', 'to', 'with'])

function matchWords(s: string): Set<string> {
  return new Set(
    normalizeTopicKey(s)
      .split('-')
      .filter((w) => w && !MATCH_STOP_WORDS.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
  )
}

/** Word overlap between two names (Jaccard over words, ignoring stop words and plural s), 0 to 1. */
export function nameMatch(a: string, b: string): number {
  const x = matchWords(a)
  const y = matchWords(b)
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const w of x) if (y.has(w)) shared++
  return shared / (x.size + y.size - shared)
}

export interface TopicClaim {
  /** Concept key within the paper. */
  id: string
  name: string
  topicKey: string
}

export interface TopicSplit {
  id: string
  from: string
  to: string
}

/**
 * Within one paper every concept gets its own topic, because knowledge is
 * stored per topic and concepts sharing one would be marked together. When
 * several concepts claim the same key, the concept whose name best matches
 * the topic's name keeps it (ties go to the earlier concept). Each other
 * concept moves to a key made from its own name, with a numeric suffix if
 * that key is already taken in this paper. Returns only the moves.
 */
export function splitSharedTopics(claims: TopicClaim[], topicName: (key: string) => string): TopicSplit[] {
  const used = new Set(claims.map((c) => c.topicKey))
  const groups = new Map<string, TopicClaim[]>()
  for (const c of claims) {
    const g = groups.get(c.topicKey)
    if (g) g.push(c)
    else groups.set(c.topicKey, [c])
  }
  const splits: TopicSplit[] = []
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const name = topicName(key) || key.replace(/-/g, ' ')
    let keeper = group[0]
    let best = nameMatch(keeper.name, name)
    for (const c of group.slice(1)) {
      const score = nameMatch(c.name, name)
      if (score > best) {
        best = score
        keeper = c
      }
    }
    for (const c of group) {
      if (c === keeper) continue
      const base = normalizeTopicKey(c.name) || `topic-${normalizeTopicKey(c.id) || 'concept'}`
      let to = base
      for (let n = 2; used.has(to); n++) to = `${base.slice(0, 56).replace(/-+$/, '')}-${n}`
      used.add(to)
      splits.push({ id: c.id, from: key, to })
    }
  }
  return splits
}

export function normalizeLevel(raw: unknown): TopicLevel {
  return raw === 'foundation' || raw === 'core' || raw === 'specialized' ? raw : 'core'
}

export interface StarterTopic {
  key: string
  name: string
  level: TopicLevel
  description: string
}

const t = (name: string, description: string, level: TopicLevel = 'foundation'): StarterTopic => ({
  key: normalizeTopicKey(name),
  name,
  level,
  description,
})

/** Common prerequisites across ML, math and CS papers. */
export const STARTER_TOPICS: StarterTopic[] = [
  t('Python programming', 'Writing and reading basic Python code.'),
  t('Derivatives and the chain rule', 'Single-variable differentiation and composing derivatives.'),
  t('Partial derivatives and gradients', 'Derivatives of multivariable functions and the gradient vector.'),
  t('Integrals', 'Definite and indefinite integration.'),
  t('Vectors and matrices', 'Vector and matrix arithmetic, matrix multiplication.'),
  t('Dot product', 'Inner product of vectors and its geometric meaning.'),
  t('Eigenvalues and eigenvectors', 'Characteristic directions and scalings of a linear map.'),
  t('Matrix decompositions (SVD)', 'Singular value decomposition and related factorizations.'),
  t('Probability basics', 'Events, random variables, conditional probability.'),
  t('Probability distributions', 'Common discrete and continuous distributions such as normal and Bernoulli.'),
  t('Expectation and variance', 'Mean and spread of a random variable.'),
  t('Bayes theorem', 'Updating probabilities with evidence.'),
  t('Maximum likelihood estimation', 'Fitting parameters by maximizing the probability of the data.'),
  t('Hypothesis testing', 'p-values, null hypotheses and significance tests.'),
  t('Big-O notation', 'Asymptotic growth of running time and memory.'),
  t('Linear regression', 'Fitting a linear model by least squares.'),
  t('Logistic regression', 'Linear classifier with a sigmoid output.'),
  t('Gradient descent', 'Iteratively minimizing a loss by following the negative gradient.'),
  t('Stochastic gradient descent', 'Gradient descent on mini-batches of data.'),
  t('Loss functions', 'Objectives such as squared error and cross-entropy.'),
  t('Overfitting and regularization', 'Generalization, L1/L2 penalties, train/validation/test splits.'),
  t('Feed-forward neural networks', 'Layers of weighted sums and nonlinear activations.'),
  t('Backpropagation', 'Computing neural network gradients with the chain rule.'),
  t('Activation functions', 'ReLU, sigmoid, tanh and similar nonlinearities.'),
  t('Softmax function', 'Turning a vector of scores into a probability distribution.'),
  t('Cross-entropy loss', 'Loss for probabilistic classification.'),
  t('Convolutional neural networks', 'Neural networks built from learned convolution filters.', 'core'),
  t('Recurrent neural networks', 'Networks that process sequences step by step (RNN, LSTM, GRU).', 'core'),
  t('Word embeddings', 'Dense vector representations of tokens.', 'core'),
  t('Attention mechanism', 'Weighting inputs by learned relevance (queries, keys, values).', 'core'),
  t('Transformer architecture', 'Self-attention based encoder/decoder networks.', 'core'),
  t('Tokenization', 'Splitting text into subword units such as byte-pair encoding.', 'core'),
  t('Language models', 'Models that predict the next token in a sequence.', 'core'),
  t('Adam optimizer', 'Adaptive-moment gradient optimizer.', 'core'),
  t('Dropout', 'Randomly zeroing activations during training as regularization.', 'core'),
  t('Batch and layer normalization', 'Normalizing activations to stabilize training.', 'core'),
  t('Reinforcement learning basics', 'Agents, rewards, policies and value functions.', 'core'),
  t('Variational autoencoders', 'Latent-variable generative models trained with an evidence bound.', 'core'),
  t('Diffusion models', 'Generative models that learn to reverse a noising process.', 'core'),
  t('Evaluation metrics (accuracy, precision, recall)', 'Measuring classifier quality.'),
]
