/**
 * Record shapes for every app collection. Fields live under `record.data`.
 * Shared by the worker (actions, job) and the React pages.
 */

export type PaperStatus = 'queued' | 'processing' | 'ready' | 'failed'
export type PaperStage = 'queued' | 'text' | 'concepts' | 'overview' | 'resources' | 'explain' | 'ready' | 'failed'

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
  branches: Branch[]
  /** Distinct topic keys of this paper's concepts, for progress without loading concepts. */
  topicKeys: string[]
  /** Plain-language story of the paper; missing for papers analyzed before overviews existed. */
  overview?: PaperOverview | null
  /** Set while ensureOverview is generating one, so two readers don't both pay. */
  overviewLoadingAt?: number
}

/** One step of the paper's argument in plain words, with the concepts it uses. */
export interface StoryItem {
  id: string
  text: string
  technical: string
  conceptKeys: string[]
}

export interface PaperOverview {
  /** 2 to 3 jargon-free sentences on what the paper does and why it matters. */
  plain: string
  story: StoryItem[]
  /** Concept keys no story item references, shown as "also needed". */
  alsoNeeded: string[]
  generatedAt: number
}

/** A thematic group of concepts in one paper (reader-independent). */
export interface Branch {
  key: string
  name: string
  description: string
}

export type TopicLevel = 'foundation' | 'core' | 'specialized'
export type TopicOrigin = 'starter' | 'paper'
export type ResourcesStatus = 'none' | 'loading' | 'ready' | 'failed'

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
  /** When a branch load marked this topic `loading` (ms epoch); a mark older than 5 minutes is stale. */
  resourcesLoadingAt: number
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
  /** Under 20 plain words on why this concept matters for this paper. */
  plainRole?: string
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
  /** When the reader marked the overview read; 0 or missing when unread. */
  overviewReadAt?: number
}

/** "current" and "previous" are legacy values from the single-target model and read as "active". */
export type WorkspacePaperStatus = 'active' | 'finished' | 'current' | 'previous'

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
  /** The paper opened most recently from this workspace. */
  currentPaperId: string
  papers: WorkspacePaper[]
  suggestions: Suggestion[]
  suggestionsAt: number
  lastOpenedAt: number
}

export type UsageKind = 'analyze' | 'recommend' | 'explain' | 'branch' | 'overview'
export type UsageState = 'counted' | 'refunded'

export interface UsageEventData {
  userId: string
  kind: UsageKind
  ref: string
  /** Absent on rows written before refunds existed; treated as counted. */
  state?: UsageState
}

/** Envelope as returned by worker-side record queries. */
export interface Envelope<T> {
  recordId: string
  data: T
  createdBy?: string
  createdAt?: string | number
  updatedAt?: string | number
}
