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

export interface DemoSnapshot {
  note: string
  exportedAt: string
  paper: { arxivId: string; title: string; authors: string[]; year: string; mainContribution: string; overview?: PaperOverview | null }
  branches: DemoBranch[]
  topics: Record<string, { name: string; level: string; description: string; resource: { title: string; url: string; why: string } | null }>
}

export const demoSnapshot = raw as DemoSnapshot
