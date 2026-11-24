/**
 * Prompts for the model calls. The concept prompt is reader-independent:
 * it lists every prerequisite from foundations up, and each reader then marks
 * what they already know (see FINDINGS.md: letting the model guess the reader's
 * background produced a roadmap that skipped Transformers for a beginner).
 */

export const MODEL = 'claude-haiku-5-5'

/** How the paper text was obtained, for every prompt that reads it. PDF math is often damaged. */
export function sourceNote(source: 'html' | 'pdf'): string {
  return source === 'html'
    ? "The paper text was converted from the paper's arXiv HTML version. Its math appears as LaTeX between \\( and \\) (inline) or \\[ and \\] (display), exactly as the authors wrote it."
    : 'The paper text was extracted from a PDF. It may contain extraction noise such as merged lines, and its formulas are often damaged: square roots, fractions, exponents, subscripts and Greek letters can be missing or flattened (a square root of d_k may appear as "dk"). Never rely on the exact form or value of a formula read from this text, and never state one as fact.'
}

/** Concept counts by paper length: longer papers rely on more. */
export function conceptCountRange(textChars: number): string {
  return textChars < 40_000 ? '10 to 18' : '12 to 24'
}

export function conceptsSystem(source: 'html' | 'pdf', textChars: number): string {
  return `You map out what a reader must understand to follow one research paper.

You get the paper's main text and the existing topics in a shared vocabulary. ${sourceNote(source)}

Task: list every concept the paper relies on for its main argument, from general foundations up to the paper-specific ideas, and which concepts depend on which. Do not assume any background: include the foundations the paper takes for granted, so a newcomer to the field gets a complete path.

Rules:
- List ${conceptCountRange(textChars)} concepts.
- Include 3 to 4 general foundations that a newcomer to this paper's field needs, even when the paper never explains them: for a quantum computing paper, qubits and density matrices; for a random-matrix paper, covariance matrices, eigenvalues and entropy. They come first and depend on nothing.
- Cover every object named in the main result: each quantity, class, model or method that appears in the main theorem or the headline claim gets its own concept.
- Include only concepts the paper actually relies on. Leave out anything used only in related work, a minor side experiment, or an appendix.
- quotes: up to 2 candidate passages where the paper uses the concept, best first. Each is 8 to 30 words copied exactly, character for character, from one prose sentence in the paper text, with any LaTeX exactly as it appears there. A quote is a complete statement in words: never an equation or definition (nothing with "="), display math, a table, a caption, a citation, or a clause that ends in a lead-in such as "is", "are", "the", "as follows" or a colon. Prefer the sentence with the fewest symbols. Two concepts never share a quote. Do not paraphrase, shorten, or fix typos.
- depends_on lists ids of other concepts in your list that the reader should learn first. A concept depends on the simpler parts it is built from: a component comes before the mechanism that combines it (scaled dot-product attention before multi-head attention). No cycles.
- topic maps the concept to the shared vocabulary. Reuse an existing topic only when it is the same idea, not a broader or related one: "Multi-head attention" is not "Attention mechanism", "Positional encoding" is not "Word embeddings", and "BLEU score" is not "Evaluation metrics". For a reuse give {"key": "<existing key>", "description": "<one sentence on this concept's own idea that does not mention this paper>"}. Otherwise propose a new topic: {"key": "<lowercase-hyphenated-slug>", "name": "<name someone would search a tutorial for>", "level": "foundation" | "core" | "specialized", "description": "<one sentence that does not mention this paper>", "search_query": "<web search query that finds a beginner-friendly explainer>"}. Use "foundation" for general math, statistics, physics, CS or ML prerequisites, "core" for methods widely used in the field, and "specialized" for ideas specific to this line of research. Give each concept in this paper a distinct topic: never map two concepts to the same key.
- name is the concept as this paper uses it.
- why_needed is one sentence on what in the paper a reader could not follow without it. Write any math in why_needed as LaTeX between \\( and \\) (inline) or \\[ and \\] (display), and keep the prose plain. Quotes are the exception: copy them exactly.
- section is the section number and title where the concept is used.
- depth is "skim" (recognize the term), "working" (follow the equations or arguments that use it), or "deep" (central to the contribution).
- Group the concepts into 3 to 6 thematic branches, such as "Probability foundations", "Model architecture" or "Training objective". Each branch has a key (lowercase-hyphenated), a name and a one-line description, and holds at least 2 concepts. Order branches from most foundational to most specific. Give every concept a branch_key from your branches.

Output only valid JSON (escape any double quotes and backslashes inside strings, no trailing commas), no prose and no code fences:
{"main_contribution": string, "branches": [{"key": string, "name": string, "description": string}], "concepts": [{"id": "c1", "name": string, "why_needed": string, "section": string, "quotes": [string], "depends_on": [string], "depth": "skim" | "working" | "deep", "branch_key": string, "topic": {"key": string, "name"?: string, "level"?: string, "description"?: string, "search_query"?: string}}]}`
}

export function conceptsUser(args: {
  title: string
  abstract: string
  topics: { key: string; name: string; description?: string }[]
  text: string
}): string {
  const topicLines = args.topics.map((t) => `${t.key}: ${t.name}${t.description ? ` (${t.description})` : ''}`).join('\n')
  return `Existing topics (key: name (description)):\n${topicLines || '(none yet)'}\n\nPaper title: ${args.title}\nAbstract: ${args.abstract}\n\nPaper text (references and appendices removed):\n<paper>\n${args.text}\n</paper>`
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

export function explainSystem(source: 'html' | 'pdf'): string {
  return `You write a section-by-section walkthrough of one research paper, for a reader who is still learning the field.

You get the paper's main text and the list of concepts it relies on (id, name, why it matters). ${sourceNote(source)}

Write sections: a walkthrough of the paper's main sections in order, 4 to 10 entries. For each: heading (the paper's section number and title), summary (3 to 5 plain sentences on what the section does and why it matters to the argument, stating only what the section itself says), and concept_ids (ids from the concept list that the section uses).

Write math in summaries as LaTeX between \\( and \\) (inline) or \\[ and \\] (display), escaped for JSON, and keep the prose plain.

Output only valid JSON (escape any double quotes and backslashes inside strings, no trailing commas), no prose and no code fences:
{"sections": [{"heading": string, "summary": string, "concept_ids": [string]}]}`
}

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
  mode?: 'starter' | 'next'
  name: string
  description: string
  knownTopics: string[]
  existing: string[]
  candidates: PaperCandidate[]
}): string {
  const results = args.candidates.map((c) => `${c.n}. [${c.arxivId}] ${c.title}\n   ${c.snippet}`).join('\n')
  const modeLine =
    args.mode === 'starter'
      ? 'Mode: starter. This workspace is new: pick the famous, foundational, introductory or survey papers a newcomer to the subject should read first.'
      : 'Mode: next. Pick what this learner should read next, given the papers already in the workspace and what they know.'
  return `${modeLine}\n\nWorkspace: ${args.name}\nDescription: ${args.description || '(none)'}\n\nTopics the learner knows (${args.knownTopics.length}): ${args.knownTopics.join('; ') || '(none yet)'}\n\nAlready in the workspace: ${args.existing.join('; ') || '(none)'}\n\nSearch results:\n${results}`
}

export const EXPLAIN_CONCEPT_SYSTEM = `You explain one concept to a learner who is reading a specific research paper and got stuck on it.

Write Markdown, 150 to 350 words, with these parts:
1. What it is, in plain language.
2. How this paper uses it, referring to the passage you are given.
3. A small worked example with concrete numbers, a tiny derivation, or a few lines of Python.
4. One common misconception to avoid.

Write math as LaTeX between \\( and \\) (inline) or \\[ and \\] (display); keep the prose plain.

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

export function overviewSystem(source: 'html' | 'pdf'): string {
  return `You explain one research paper to a reader with little background in its field. They will study the paper's concepts one at a time and first need to see the paper's story and where each concept fits. ${sourceNote(source)}

Return only one JSON object, with every string valid JSON (escape double quotes and backslashes), no Markdown:
{
  "plain": "2 to 3 sentences in everyday words: what the paper does and why it matters. No jargon, no symbols, no acronyms.",
  "story": [
    {
      "text": "One plain sentence under 30 words, one step of the paper's argument, in the order the paper makes it.",
      "technical": "One precise sentence of the form: Here the paper uses <concept> to <do what>. Math as LaTeX in \\\\( \\\\) or \\\\[ \\\\].",
      "concept_keys": ["keys from the concept list that this step relies on"]
    }
  ],
  "roles": [{ "key": "<concept key>", "plain_role": "Under 20 plain words: why this concept matters for this paper." }]
}

Rules:
- 5 to 8 story items. Start with the problem the paper addresses and end with what it achieves.
- Say only what the paper says. Every plain sentence, technical line and role must be something the given text states or shows, with the paper's own hedges. Never add numbers, settings, comparisons, history or causes the text does not give, and keep straight what the paper credits to what (which part does the work, what was known before, what is new).
- A story "text" uses no technical term, symbol, acronym or concept name unless the same sentence says what it means in everyday words ("a codeword, a string the sender and receiver agree on in advance, ..."). If a step can't be said that way, describe what it achieves instead.
- Use only concept keys from the list. Each story item names the 1 to 4 concepts it really relies on. Most concepts should appear in some item, but only where they fit naturally.
- Give one role for every concept in the list.
- Each "technical" line must read as a grammatical sentence with the formulas removed. Put a formula after the words that say what it is ("maps the input sequence \\\\((x_1, \\\\dots, x_n)\\\\) to representations \\\\(\\\\mathbf{z}\\\\)"), never in place of a verb or object.
- The plain sentences are for a curious newcomer: short words, no formulas, no unexplained terms.${source === 'pdf' ? '\n- The text came from a PDF, so its formulas may be damaged: in technical lines, write a formula only when the surrounding words make it unambiguous.' : ''}`
}

export function overviewUser(args: {
  title: string
  abstract: string
  mainContribution: string
  text: string
  concepts: { key: string; name: string; whyNeeded: string; section: string; quote?: string }[]
  /** Problems a check found in an earlier draft, for the one rewrite. */
  feedback?: string[]
}): string {
  const list = args.concepts
    .map((c) => `- ${c.key}: ${c.name} (used in ${c.section || 'the paper'}). ${c.whyNeeded}${c.quote ? `\n  Quote: "${c.quote}"` : ''}`)
    .join('\n')
  const feedback = args.feedback?.length
    ? `\n\nAn earlier draft of this overview was rejected. A check against the paper found these problems; fix all of them:\n${args.feedback.map((f) => `- ${f}`).join('\n')}`
    : ''
  return `Paper: ${args.title}\n\nAbstract:\n${args.abstract}\n\nMain contribution: ${args.mainContribution || '(not given)'}\n\nConcepts:\n${list}\n\nStart of the paper's text:\n<paper>\n${args.text}\n</paper>${feedback}`
}

export function verifySystem(source: 'html' | 'pdf'): string {
  return `You check a plain-language overview of one research paper against the paper itself. The overview is for a curious newcomer to the field, so it must be both true to the paper and free of unexplained jargon. ${sourceNote(source)}

You get the paper's abstract, the start of its text, its concepts with a passage where each is used, and the overview: a summary ("plain"), a story of numbered steps (each with a plain sentence "text" and a precise sentence "technical"), and one plain role per concept.

Judge each item on its own:
- text_supported: true when the paper states or clearly implies what the plain sentence says. False when it adds a specific the paper does not give (a number, a setting, a comparison, history, a cause), misstates or overstates a result, reverses what is known or new, or credits the wrong part of the method. When the given text neither supports nor contradicts a broad statement that fits the abstract, it is supported.
- jargon: true when the plain sentence uses a technical term, symbol, acronym or concept name that a newcomer would not know and the same sentence does not say what it means.
- technical_supported: the same standard as text_supported for the technical sentence, including any formula in it.
- plain_supported: the same standard for the summary.
- For each role, supported: the same standard.
- note: whenever something is false (or jargon is true), one short sentence saying what is wrong and what the paper actually says.

Output only valid JSON (escape any double quotes and backslashes inside strings, no trailing commas), no prose and no code fences:
{"plain_supported": boolean, "plain_note"?: string, "story": [{"id": string, "text_supported": boolean, "jargon": boolean, "technical_supported": boolean, "note"?: string}], "roles": [{"key": string, "supported": boolean, "note"?: string}]}`
}

export function verifyUser(args: {
  title: string
  abstract: string
  text: string
  concepts: { key: string; name: string; whyNeeded: string; quote?: string }[]
  plain: string
  story: { id: string; text: string; technical: string }[]
  roles: { key: string; role: string }[]
}): string {
  const concepts = args.concepts
    .map((c) => `- ${c.key}: ${c.name}. ${c.whyNeeded}${c.quote ? `\n  Passage: "${c.quote}"` : ''}`)
    .join('\n')
  const story = args.story.map((s) => `${s.id}\n  text: ${s.text}\n  technical: ${s.technical || '(none)'}`).join('\n')
  const roles = args.roles.map((r) => `- ${r.key}: ${r.role}`).join('\n')
  return `Paper: ${args.title}\n\nAbstract:\n${args.abstract}\n\nStart of the paper's text:\n<paper>\n${args.text}\n</paper>\n\nConcepts:\n${concepts}\n\nOverview to check\n\nplain: ${args.plain}\n\nstory:\n${story}\n\nroles:\n${roles || '(none)'}`
}
