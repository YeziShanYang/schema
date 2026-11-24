/**
 * Record shapes for every app collection. Fields live under `record.data`.
 * Shared by the worker (actions, job) and the React pages.
 */

export type PaperStatus = 'queued' | 'processing' | 'ready' | 'failed'
export type PaperStage = 'queued' | 'text' | 'concepts' | 'resources' | 'explain' | 'ready' | 'failed'

export interface PaperData {
  arxivId: string
  version: string
  title: string
  authors: string[]
  abstract: string
  primaryCategory: string
  publishedAt: string
  status: PaperStatus
  stage: PaperStage
  progress: number
  progressMessage: string
  error: string
  mainContribution: string
  textChars: number
  textKey: string
  conceptCount: number
  requestedBy: string
  branches: Branch[]
}

/** A thematic group of concepts in one paper (reader-independent). */
export interface Branch {
  key: string
  name: string
  description: string
}

export type TopicLevel = 'foundation' | 'core' | 'specialized'
export type TopicOrigin = 'starter' | 'paper'
export type ResourcesStatus = 'none' | 'ready' | 'failed'

export interface TopicResource {
  title: string
  url: string
  why: string
}

export interface TopicData {
  key: string
  name: string
  level: TopicLevel
  description: string
  searchQuery: string
  resources: TopicResource[]
  resourcesStatus: ResourcesStatus
  origin: TopicOrigin
}

export type ConceptDepth = 'skim' | 'working' | 'deep'

export interface CheckQuestion {
  question: string
  choices: string[]
  answerIndex: number
  explanation: string
}

export interface ConceptData {
  paperId: string
  arxivId: string
  key: string
  topicKey: string
  name: string
  whyNeeded: string
  section: string
  quote: string
  quoteVerified: boolean
  dependsOn: string[]
  tier: number
  depth: ConceptDepth
  order: number
  check: CheckQuestion | null
  branchKey: string
  /** Cached "Explain with AI" text (Markdown), shared by every reader. */
  explanation: string
  explanationAt: number
}

export interface SectionData {
  paperId: string
  arxivId: string
  order: number
  heading: string
  summary: string
  conceptKeys: string[]
}

export type KnowledgeStatus = 'known' | 'learning'
export type KnowledgeSource = 'self' | 'paper' | 'check' | 'finished'

export interface KnowledgeData {
  userId: string
  topicKey: string
  status: KnowledgeStatus
  source: KnowledgeSource
  paperId: string
  arxivId: string
}

export type RoadmapStatus = 'reading' | 'finished'

export interface RoadmapData {
  userId: string
  paperId: string
  arxivId: string
  title: string
  status: RoadmapStatus
  lastOpenedAt: number
  finishedAt: number
}

export type WorkspacePaperStatus = 'current' | 'finished' | 'previous'

export interface WorkspacePaper {
  paperId: string
  arxivId: string
  title: string
  status: WorkspacePaperStatus
  addedAt: number
}

export interface Suggestion {
  arxivId: string
  title: string
  authors: string[]
  reason: string
}

export interface WorkspaceData {
  userId: string
  name: string
  description: string
  currentPaperId: string
  papers: WorkspacePaper[]
  suggestions: Suggestion[]
  suggestionsAt: number
  lastOpenedAt: number
}

export type UsageKind = 'recommend' | 'explain'

export interface UsageEventData {
  userId: string
  kind: UsageKind
  ref: string
}

/** Envelope as returned by worker-side record queries. */
export interface Envelope<T> {
  recordId: string
  data: T
  createdBy?: string
  createdAt?: string | number
  updatedAt?: string | number
}
