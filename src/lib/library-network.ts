/**
 * The Library's topic constellation as data, with no React in it: the topics
 * that two or more of the shown papers share, each paper's own topics, which
 * of them the reader has checked, which papers share which topics, and which
 * topics connect the papers the reader selects.
 */

export interface NetworkPaperInput {
  /** The paper's record id. */
  id: string
  topicKeys?: readonly string[] | null
}

/** A row of the reader's concept_knowledge: the concept's paper and topic. */
export interface ConceptCheck {
  paperId: string
  topicKey: string
  status?: string
  /** Left by a re-analysis with no matching concept; it checks nothing. */
  stale?: boolean
}

export interface OwnTopic {
  key: string
  name: string
  /** The reader checked a concept with this topic in this paper. */
  checked: boolean
}

export interface SharedTopic {
  key: string
  name: string
  /** The reader checked a concept with this topic, in any paper. */
  checked: boolean
  /** The shown papers that use the topic, in the order the papers came in. */
  paperIds: string[]
}

export interface PaperPair {
  a: string
  b: string
  /** The topics both papers use, in the order of `shared`. */
  keys: string[]
}

export type NetworkPaper<P extends NetworkPaperInput> = P & {
  /** The paper's topics that no other shown paper uses, in the paper's order. */
  own: OwnTopic[]
}

export interface LibraryNetwork<P extends NetworkPaperInput = NetworkPaperInput> {
  /** The papers in the order they came in, each once. */
  papers: NetworkPaper<P>[]
  /** Topics used by two or more of the papers: most papers first, then by name. */
  shared: SharedTopic[]
  /** Every two papers that share at least one topic. */
  pairs: PaperPair[]
}

/**
 * Builds the constellation for `papers`. A check counts unless it is stale or
 * its status is something other than known, the same rule as the Library's
 * counts. A topic missing from `names` is shown under its key.
 */
export function libraryNetwork<P extends NetworkPaperInput>(
  papers: readonly P[],
  checks: Iterable<ConceptCheck>,
  names: ReadonlyMap<string, string>,
): LibraryNetwork<P> {
  const checkedAnywhere = new Set<string>()
  const checkedIn = new Set<string>()
  for (const c of checks) {
    if ((c.status && c.status !== 'known') || c.stale || !c.topicKey) continue
    checkedAnywhere.add(c.topicKey)
    checkedIn.add(`${c.paperId}\n${c.topicKey}`)
  }
  const nameOf = (key: string) => names.get(key) || key

  const seen = new Set<string>()
  const unique = papers.filter((p) => !seen.has(p.id) && !!seen.add(p.id))
  const keysOf = new Map(unique.map((p) => [p.id, [...new Set((p.topicKeys ?? []).filter(Boolean))]]))

  const users = new Map<string, string[]>()
  for (const p of unique) for (const key of keysOf.get(p.id)!) users.set(key, [...(users.get(key) ?? []), p.id])
  const shared: SharedTopic[] = [...users]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, paperIds]) => ({ key, name: nameOf(key), checked: checkedAnywhere.has(key), paperIds }))
    .sort((a, b) => b.paperIds.length - a.paperIds.length || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
  const sharedKeys = new Set(shared.map((s) => s.key))

  const out = unique.map((p) => ({
    ...p,
    own: keysOf
      .get(p.id)!
      .filter((key) => !sharedKeys.has(key))
      .map((key) => ({ key, name: nameOf(key), checked: checkedIn.has(`${p.id}\n${key}`) })),
  }))

  const pairs: PaperPair[] = []
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i].id
      const b = unique[j].id
      const keys = shared.filter((s) => s.paperIds.includes(a) && s.paperIds.includes(b)).map((s) => s.key)
      if (keys.length) pairs.push({ a, b, keys })
    }
  }
  return { papers: out, shared, pairs }
}

/** The papers that share topics with `paperId`, each with the shared topic keys, in the order of `network.pairs`. */
export function sharedWith(network: Pick<LibraryNetwork, 'pairs'>, paperId: string): { id: string; keys: string[] }[] {
  return network.pairs.filter((p) => p.a === paperId || p.b === paperId).map((p) => ({ id: p.a === paperId ? p.b : p.a, keys: p.keys }))
}

export interface Connection {
  key: string
  name: string
  checked: boolean
  /** The selected papers that use the topic, in the order of the topic's papers. */
  selected: string[]
  /** The other shown papers that use it. */
  others: string[]
  /** Every selected paper uses it. Only set with two or more papers selected. */
  all: boolean
}

/**
 * The shared topics that connect a selection of papers. With one paper
 * selected, that is every shared topic the paper uses. With two or more, it is
 * every shared topic that at least two of them use, with `all` set on those
 * that every one of them uses. Topics used by all come first, then those used
 * by more of the selection, then the order of `network.shared`. Ids that are
 * not in the network are ignored.
 */
export function selectionConnections(network: Pick<LibraryNetwork, 'papers' | 'shared'>, selected: Iterable<string>): Connection[] {
  const shown = new Set(network.papers.map((p) => p.id))
  const sel = new Set([...selected].filter((id) => shown.has(id)))
  if (!sel.size) return []
  const need = sel.size === 1 ? 1 : 2
  return network.shared
    .map((s, i) => {
      const mine = s.paperIds.filter((id) => sel.has(id))
      return {
        i,
        c: {
          key: s.key,
          name: s.name,
          checked: s.checked,
          selected: mine,
          others: s.paperIds.filter((id) => !sel.has(id)),
          all: sel.size > 1 && mine.length === sel.size,
        },
      }
    })
    .filter(({ c }) => c.selected.length >= need)
    .sort((a, b) => Number(b.c.all) - Number(a.c.all) || b.c.selected.length - a.c.selected.length || a.i - b.i)
    .map(({ c }) => c)
}

/** The keys of the shared topics that every selected paper uses; empty unless two or more are selected. */
export function sharedByAll(network: Pick<LibraryNetwork, 'papers' | 'shared'>, selected: Iterable<string>): string[] {
  return selectionConnections(network, selected)
    .filter((c) => c.all)
    .map((c) => c.key)
}

/** The selected ids still among the shown papers, in their order. */
export function keepShown(selected: readonly string[], network: Pick<LibraryNetwork, 'papers'>): string[] {
  const shown = new Set(network.papers.map((p) => p.id))
  return selected.filter((id) => shown.has(id))
}

/**
 * A string that changes only when the drawing's structure does: which papers,
 * which shared topics link to which papers, and each paper's own topics. Names,
 * counts and checkmarks are left out, so they can change without a new layout.
 */
export function networkShape(network: LibraryNetwork): string {
  const papers = network.papers.map((p) => `${p.id}:${p.own.map((t) => t.key).join(',')}`).sort()
  const shared = network.shared.map((s) => `${s.key}:${[...s.paperIds].sort().join(',')}`).sort()
  return `${papers.join('|')}#${shared.join('|')}`
}

/** The canvas height for `n` papers: 300px plus 40px a paper, between 560px and 900px. */
export function constellationHeight(n: number): number {
  return Math.max(560, Math.min(900, 300 + 40 * n))
}
