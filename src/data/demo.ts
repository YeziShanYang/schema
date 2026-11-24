/**
 * Typed access to the bundled demo snapshot (src/data/demo-snapshot.json),
 * exported from a real pipeline run by scripts/export-demo-snapshot.mjs.
 * Used by the static landing page, which cannot read live data.
 */

import raw from './demo-snapshot.json'
import type { PaperOverview } from '../types'

export interface DemoConcept {
  key: string
  name: string
  depth: 'skim' | 'working' | 'deep'
  tier: number
  whyNeeded: string
  quote: string
  /** `quote` with its formulas as LaTeX; empty when the paper has none (see ConceptData.quoteDisplay). */
  quoteDisplay?: string
  section: string
  topicKey: string
  explanation: string
  /** Present in snapshots exported after the overview existed. */
  order?: number
  dependsOn?: string[]
  plainRole?: string
}

export interface DemoBranch {
  key: string
  name: string
  description: string
  concepts: DemoConcept[]
}

export interface DemoFirstPage {
  /** The arXiv stamp in the margin, e.g. "arXiv:1706.03762v7 [cs.CL] 2 Aug 2023". */
  stamp: string
  /** Section 1, lines joined into one string. */
  introduction: string
  /** Figure 1's caption, when the paper has one. */
  figureCaption: string
}

export interface DemoSnapshot {
  note: string
  exportedAt: string
  paper: {
    arxivId: string
    title: string
    authors: string[]
    year: string
    mainContribution: string
    /** The arXiv abstract. */
    abstract?: string
    /** Verbatim text from the PDF's first page, for the landing illustration; null when it couldn't be read. */
    firstPage?: DemoFirstPage | null
    overview?: PaperOverview | null
  }
  branches: DemoBranch[]
  topics: Record<string, { name: string; level: string; description: string; resource: { title: string; url: string; why: string } | null }>
}

export const demoSnapshot = raw as DemoSnapshot
