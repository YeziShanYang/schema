/**
 * Prompts for the three model calls. The concept prompt is reader-independent:
 * it lists every prerequisite from foundations up, and each reader then marks
 * what they already know (see FINDINGS.md: letting the model guess the reader's
 * background produced a roadmap that skipped Transformers for a beginner).
 */

export const MODEL = 'claude-haiku-5-5'

export const CONCEPTS_SYSTEM = `You map out what a reader must understand to follow one research paper.

You get the paper's main text, extracted from a PDF (it may contain extraction noise such as broken equations or merged lines), and the existing topics in a shared vocabulary.

Task: list every concept the paper relies on for its main argument, from general foundations up to the paper-specific ideas, and which concepts depend on which. Do not assume any background: include the foundations the paper takes for granted, so a beginner gets a complete path.

Rules:
- Include only concepts the paper actually relies on. Tie each one to a quote of 8 to 30 words copied exactly, character for character, from a prose sentence in the paper text where the concept is used. Do not quote equations, tables, captions or citations. Do not paraphrase, shorten, or fix typos in the quote.
- Leave out anything used only in related work, a minor side experiment, or an appendix.
- Aim for 8 to 18 concepts.
- depends_on lists ids of other concepts in your list that the reader should learn first. No cycles.
- topic maps the concept to the shared vocabulary. If an existing topic is the same concept (not merely related), use {"key": "<existing key>"}. Otherwise propose a new topic: {"key": "<lowercase-hyphenated-slug>", "name": "<name someone would search a tutorial for>", "level": "foundation" | "core" | "specialized", "description": "<one sentence that does not mention this paper>", "search_query": "<web search query that finds a beginner-friendly explainer>"}. Use "foundation" for general math, statistics, CS or ML prerequisites, "core" for methods widely used in the field, and "specialized" for ideas specific to this line of research. Give different concepts different topics.
- name is the concept as this paper uses it.
- why_needed is one sentence on what in the paper a reader could not follow without it.
- section is the section number and title where the concept is used.
- depth is "skim" (recognize the term), "working" (follow the equations or arguments that use it), or "deep" (central to the contribution).
- Group the concepts into 3 to 6 thematic branches, such as "Probability foundations", "Model architecture" or "Training objective". Each branch has a key (lowercase-hyphenated), a name and a one-line description. Order branches from most foundational to most specific. Give every concept a branch_key from your branches, and give every branch at least one concept.

Output only valid JSON (escape any double quotes inside strings, no trailing commas), no prose and no code fences:
{"main_contribution": string, "branches": [{"key": string, "name": string, "description": string}], "concepts": [{"id": "c1", "name": string, "why_needed": string, "section": string, "quote": string, "depends_on": [string], "depth": "skim" | "working" | "deep", "branch_key": string, "topic": {"key": string, "name"?: string, "level"?: string, "description"?: string, "search_query"?: string}}]}`

export function conceptsUser(args: {
  title: string
  abstract: string
  topics: { key: string; name: string }[]
  text: string
}): string {
  const topicLines = args.topics.map((t) => `${t.key}: ${t.name}`).join('\n')
  return `Existing topics (key: name):\n${topicLines || '(none yet)'}\n\nPaper title: ${args.title}\nAbstract: ${args.abstract}\n\nPaper text (references and appendices removed):\n<paper>\n${args.text}\n</paper>`
}

export const RESOURCES_SYSTEM = `You pick learning resources for topics a beginner needs before reading a research paper.

For each topic you get its name, a one-line description, and numbered web search results (title, URL, snippet).

Rules:
- Choose the one or two results that would best teach a beginner the topic. Prefer tutorials, lecture notes, textbook chapters, well-known explainer articles and videos. Avoid research papers, forum questions, paywalled pages and pages about a different topic.
- Use only URLs that appear in the results, copied exactly. Never invent a URL.
- If no result fits, return an empty list for that topic.
- why is one sentence on what the resource covers and why it helps a beginner.

Output only valid JSON (escape any double quotes inside strings, no trailing commas), no prose and no code fences:
{"topics": [{"key": string, "resources": [{"url": string, "why": string}]}]}`

export interface Candidate {
  title: string
  url: string
  snippet: string
}

export function resourcesUser(items: { key: string; name: string; description: string; candidates: Candidate[] }[]): string {
  return items
    .map((it) => {
      const lines = it.candidates
        .map((c, i) => `  ${i + 1}. ${c.title}\n     ${c.url}\n     ${c.snippet}`)
        .join('\n')
      return `TOPIC ${it.key}\nName: ${it.name}\nDescription: ${it.description}\nResults:\n${lines || '  (no results)'}`
    })
    .join('\n\n')
}

export const EXPLAIN_SYSTEM = `You write a study guide for one research paper, for a reader who is still learning the field.

You get the paper's main text and the list of concepts it relies on (id, name, why it matters).

Write two things:
1. sections: a walkthrough of the paper's main sections in order, 4 to 10 entries. For each: heading (the paper's section number and title), summary (3 to 5 plain sentences on what the section does and why it matters to the argument), and concept_ids (ids from the concept list that the section uses).
2. checks: one multiple-choice question per concept that tests understanding of the concept as this paper uses it. Exactly 4 choices, one correct, with answer_index (0 to 3) and a one-sentence explanation. Vary which position holds the correct answer.

Output only valid JSON (escape any double quotes inside strings, no trailing commas), no prose and no code fences:
{"sections": [{"heading": string, "summary": string, "concept_ids": [string]}], "checks": [{"concept_id": string, "question": string, "choices": [string, string, string, string], "answer_index": number, "explanation": string}]}`

export function explainUser(args: {
  title: string
  concepts: { key: string; name: string; whyNeeded: string }[]
  text: string
}): string {
  const list = args.concepts.map((c) => `${c.key}: ${c.name} (${c.whyNeeded})`).join('\n')
  return `Paper title: ${args.title}\n\nConcepts:\n${list}\n\nPaper text (references and appendices removed):\n<paper>\n${args.text}\n</paper>`
}

export const RECOMMEND_SYSTEM = `You recommend the next research paper for a learner's study workspace.

You get the workspace name and description, topics the learner already knows (possibly none), papers already in the workspace, and numbered arXiv search results.

Rules:
- Pick the 3 best papers from the results for this learner to study next. Skip papers already in the workspace and results that are off-topic.
- When the learner knows few topics, prefer clearly written papers that teach broadly useful ideas: surveys, tutorials, and foundational or widely cited work. When they know many, prefer more specialized or recent work that builds on what they know.
- Refer to papers only by their result number. Never invent a paper.
- reason is one sentence on why this paper fits this learner now.

Output only valid JSON (escape any double quotes inside strings, no trailing commas), no prose and no code fences:
{"picks": [{"n": number, "reason": string}]}`

export interface PaperCandidate {
  n: number
  arxivId: string
  title: string
  snippet: string
}

export function recommendUser(args: {
  name: string
  description: string
  knownTopics: string[]
  existing: string[]
  candidates: PaperCandidate[]
}): string {
  const results = args.candidates.map((c) => `${c.n}. [${c.arxivId}] ${c.title}\n   ${c.snippet}`).join('\n')
  return `Workspace: ${args.name}\nDescription: ${args.description || '(none)'}\n\nTopics the learner knows (${args.knownTopics.length}): ${args.knownTopics.join('; ') || '(none yet)'}\n\nAlready in the workspace: ${args.existing.join('; ') || '(none)'}\n\nSearch results:\n${results}`
}

export const EXPLAIN_CONCEPT_SYSTEM = `You explain one concept to a learner who is reading a specific research paper and got stuck on it.

Write Markdown, 150 to 350 words, with these parts:
1. What it is, in plain language.
2. How this paper uses it, referring to the passage you are given.
3. A small worked example with concrete numbers, a tiny derivation, or a few lines of Python.
4. One common misconception to avoid.

No preamble, no headings larger than ###, no closing summary.`

export function explainConceptUser(args: {
  paperTitle: string
  mainContribution: string
  name: string
  whyNeeded: string
  section: string
  quote: string
  excerpt: string
}): string {
  return `Paper: ${args.paperTitle}\nMain contribution: ${args.mainContribution}\n\nConcept: ${args.name}\nWhy the paper needs it: ${args.whyNeeded}\nWhere it is used: ${args.section}\nPassage: "${args.quote}"\n\nSurrounding text from the paper:\n<excerpt>\n${args.excerpt || '(not available)'}\n</excerpt>`
}
