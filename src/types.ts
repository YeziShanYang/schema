/**
 * Record shapes for every app collection. Fields live under `record.data`.
 * Shared by the worker (actions, job) and the React pages.
 */

export type PaperStatus = 'queued' | 'processing' | 'ready' | 'failed'
export type PaperStage = 'queued' | 'text' | 'concepts' | 'overview' | 'resources' | 'explain' | 'verify' | 'ready' | 'failed'
/** Where the paper text came from: the arXiv HTML (math as LaTeX) or the PDF converted to text (math may be damaged). */
export type TextSource = 'html' | 'pdf'
/** The analysis pipeline that produced a paper's concepts; papers without one predate version 2. */
export const PIPELINE_VERSION = 2

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
  /** When the latest run entered and left each stage (see lib/analysis/timings); missing for papers analyzed before timings existed. */
  timings?: StageTimings
  /** Steps the latest run retried after a transient error. */
  retries?: number
  /** Source of the stored text; missing on papers analyzed before the HTML source existed (they used the PDF). */
  textSource?: TextSource
  /** PIPELINE_VERSION of the analysis that produced the current concepts; missing means version 1. */
  pipelineVersion?: number
  /** Story sentences and technical lines the verify stage dropped as unsupported by the paper. */
  overviewDropped?: { story: number; technical: number; regenerated: boolean }
  /** Stored concepts that ended with no quote, counted when the run finishes; missing for papers analyzed before the count existed. */
  conceptsWithoutQuote?: number
}

/** Stages with a recorded span: the queue wait, then the job's five stages. */
export type TimedStage = 'queued' | 'text' | 'concepts' | 'overview' | 'explain' | 'verify'

/** Milliseconds since the epoch, by the worker's clock. `endedAt` is missing while the stage runs. */
export interface StageTiming {
  startedAt: number
  endedAt?: number
}

export type StageTimings = Partial<Record<TimedStage, StageTiming>>

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
/**
 * `skipped`: a specialized topic only one paper uses, so no web search is made;
 * its cards lead with Explain with AI. A later paper that reuses it resets it to `none`.
 */
export type ResourcesStatus = 'none' | 'loading' | 'ready' | 'failed' | 'skipped'

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

/** Legacy: check questions are no longer generated or shown; old concept rows may still carry one. */
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
  /** Legacy field, no longer written or read. */
  check?: CheckQuestion | null
  branchKey: string
  /** Cached "Explain with AI" text (Markdown), shared by every reader. */
  explanation: string
  explanationAt: number
  /** Set while explainConcept is generating, so parallel calls don't generate twice; stale after 2 minutes. */
  explanationPendingAt?: number
  /** Under 20 plain words on why this concept matters for this paper. */
  plainRole?: string
  /** `quote` with its formulas as LaTeX, shown instead of it; set only when its words match `quote` (see lib/analysis/quote-display). */
  quoteDisplay?: string
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

/**
 * A topic in the reader's profile (collection `knowledge`), keyed by topic.
 * Profile topics only produce hints ("In your profile"); they never check a
 * concept. Rows written before per-concept knowledge existed are read the same way.
 */
export interface KnowledgeData {
  userId: string
  topicKey: string
  status: KnowledgeStatus
  source: KnowledgeSource
  paperId: string
  arxivId: string
}

export type ConceptKnowledgeSource = 'self' | 'finished'

/**
 * One concept the reader checked (collection `concept_knowledge`), one row per
 * (userId, conceptId). Checking a concept never checks anything in another
 * paper; the name and topic are kept for hints and display.
 */
export interface ConceptKnowledgeData {
  userId: string
  /** The concept's record id. */
  conceptId: string
  paperId: string
  arxivId: string
  conceptName: string
  topicKey: string
  status: 'known'
  source: ConceptKnowledgeSource
  /** Set by a re-analysis when no new concept matched this row's name: listed under its paper as "from an earlier analysis". */
  stale?: boolean
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
  /** Legacy list from before workspace_papers; moved into rows on first load and then emptied. */
  papers: WorkspacePaper[]
  suggestions: Suggestion[]
  suggestionsAt: number
  lastOpenedAt: number
}

/** One paper in one workspace, a row per paper so concurrent adds never overwrite each other. */
export interface WorkspacePaperData {
  userId: string
  workspaceId: string
  paperId: string
  arxivId: string
  title: string
  status: 'active' | 'finished'
  addedAt: number
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
