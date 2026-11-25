/**
 * The depth rule applied when a paper's concepts are written: a foundation
 * with no prerequisites (no depends_on, and a topic at the foundation level)
 * is at most "working". "Deep" means central to the paper's contribution,
 * which a general prerequisite such as total variation distance or the
 * digamma function is not. Paper-specific concepts keep the model's depth,
 * as does a foundation-level topic the paper builds from other concepts.
 */

import type { ConceptDepth, TopicLevel } from '../../types'

export function foundationDepth(depth: ConceptDepth, dependsOn: readonly string[], topicLevel: TopicLevel | undefined): ConceptDepth {
  return depth === 'deep' && dependsOn.length === 0 && topicLevel === 'foundation' ? 'working' : depth
}
