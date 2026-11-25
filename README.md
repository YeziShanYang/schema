# Schema

Schema turns an arXiv paper into a learning roadmap. A reader creates a workspace for a subject (for example "CS 229"), adds papers to it from three recommendations or by pasting a link, and the app lists every concept each paper relies on. Concepts are grouped into 3 to 6 thematic branches and ordered by prerequisite. Each one comes with the passage where the paper uses it, explainers found on the web and an optional AI explanation. The reader checks off the concepts they know, paper by paper, and a concept they checked in another paper shows a hint instead of being checked for them.

Live at https://schema.app.space. Built on the [DeepSpace SDK](https://docs.deep.space) (Cloudflare Workers, Durable Objects).

The frontend uses the Blueprint theme (IBM Plex, dot-grid canvas). Data access is in the hooks in `src/hooks` and the modules in `src/lib`, and views can be redesigned without touching the backend.

## Interface

A workspace page shows its papers as cards floating around the workspace name. Recommended papers appear as dashed cards with an Add button. A paper page shows its branches the same way, numbered in the recommended order. Clicking a branch opens a centered panel with that branch's concepts, and the branch's explainer links load when the panel opens. A toggle switches the paper page to the section walkthrough. Below 640px the cards stack in a list, and with reduced motion they hold still instead of drifting.

`recommendedSequence()` in `src/lib/sequence.ts` orders branches by the mean prerequisite tier of their concepts, keeping the model's order on ties. Concepts are ordered by tier, then branch, then the model's order. The next concept is the first unchecked one whose dependencies are all checked. The paper page shows the steps and a Next up button, and the workspace page names the paper to continue with its next concept.

The Add button opens one window for papers and workspaces. For a paper, `peekPaper` looks up the link on arXiv and reports whether the paper is already analyzed. The reader then picks an existing workspace or a new one, with a name suggested from the arXiv category. A new workspace is created only after the paper checks out. A workspace created from this window asks `recommendPapers` for starter papers once.

## How a paper is analyzed

`analyzePaper` (a server action) validates the arXiv id, returns the cached analysis if anyone has analyzed the paper before, checks the caller's daily cap, confirms the paper exists with the arXiv API, and enqueues an `analyze` background job. The job (`src/server/pipeline/run.ts`) runs in short checkpointed ticks:

1. Seed the starter topics if they are missing, and clear the concepts and sections of an earlier analysis.
2. Get the text. The job fetches `https://arxiv.org/html/<id>` (one request with a generic User-Agent, retried once after a 429) and converts it with `src/lib/paper-html.ts`: every formula becomes its LaTeX `alttext` between `\(` and `\)`, or `\[` and `\]` for display math, and the bibliography, appendices, footnotes and page chrome are dropped. Only when there is no HTML, or it yields under 4,000 characters, does `cloudconvert/convert-file` convert the PDF, and then the text is cut at the References heading. Either way the text is capped at 90,000 characters and stored with `appFiles`, and the paper records `textSource` (`html` or `pdf`). PDF text often loses roots, fractions and exponents, so every prompt that reads it is told not to trust its formulas.
3. One Claude Haiku 5.5 call lists the concepts the paper relies on (10 to 18, or up to 24 for text over 40,000 characters), starting with the general foundations a newcomer to the field needs, with up to two candidate quotes, dependencies, depth, a branch and a topic. The server then applies its rules:
   - Dangling dependencies are dropped, cycles broken and tiers computed.
   - A branch with one concept merges into the branch holding most of its dependency neighbours, or into "Other concepts" (`src/lib/branch-merge.ts`).
   - When the branches then depend on each other in a circle, which would make the recommended sequence fall back to the model's order, misfiled concepts move (`src/lib/branch-placement.ts`): a tier-0 concept that an earlier branch uses goes to the earliest such branch, and a concept whose prerequisites outside its branch all lie in later branches goes to the latest of those. A move is kept only when it lowers the number of dependencies pointing to a later branch and leaves its branch with at least two concepts. Each move is logged.
   - A concept may reuse an existing topic only when the two names share a content word, ignoring stop words, plurals and generic head nouns such as "score" or "matrix". Otherwise it gets a topic named for itself (`sharesContentWord` in `src/lib/topics.ts`). The prompt lists up to 150 existing topics with short descriptions, foundation and core first.
   - The quote is the first candidate that is found in the paper text, has at least 8 words, contains no `=` or display math, doesn't end in a lead-in ("is", "the", "as follows", a colon, an equation reference such as "(9)"), has its brackets closed and isn't another concept's quote (`src/lib/quote-rules.ts`). The text right after the quote is checked too: a quote that stops where its sentence goes on into a formula, a colon, its main clause or its verb is carried on to the end of the sentence if the longer quote passes the same rules, and rejected otherwise. A quote that stops inside a bracket is carried on the same way.
   - A concept whose candidates all fail takes the first sentence of the paper text that contains its name, its topic's name, an abbreviation of either, or a shorter form of either (such as "Bellman recursion" for "Bellman recursion for a priced query"), and that passes the same rules (`src/lib/quote-fallback.ts`). Sentences with two or more citations, or that open by referring to the sentence before, are skipped. A concept with no such sentence shows no quote, and the paper records how many concepts ended without one in `conceptsWithoutQuote`. On the HTML path a quote with math is shown through KaTeX as it stands.
4. One Haiku call writes the plain-language overview (summary, story and a plain role per concept). Its prompt forbids unexplained terms in the story's plain sentences. A concept with no plain role shows no "Where it fits" line; its card already shows the why-needed line.
5. One Haiku call writes the section walkthrough.
6. The `verify` stage: one Haiku call reads the abstract, the first 12,000 characters, each concept's quote and the overview, and judges every story sentence, technical line and plain role (`src/server/pipeline/verify.ts`). An unsupported technical line, plain role or story sentence is dropped, while at least four sentences remain. If fewer would remain, or the summary itself is unsupported, the overview is written once more with the problems as feedback and checked again. Sentences flagged for unexplained jargon are logged and passed to that rewrite, but never dropped, because the judge flags everyday words ("GPUs") and dropping cut the end of the story. The paper records what was dropped in `overviewDropped`.
7. Readers' checkmarks from an earlier analysis of the paper move to the new concepts with the same normalized name (`src/lib/knowledge-remap.ts`). A checkmark with no match stays, marked stale.
8. The paper is marked ready with `pipelineVersion: 2`.

Explainer links are not part of the job. When a reader opens a branch and asks for links, `loadBranchResources` runs one `exa/search` per topic in that branch that has no links yet, then one Haiku call per five topics picks one or two results. A topic the pick finds nothing for keeps an empty list. Raw search results are used only when the pick call fails, and only those whose title shares at least two content words with the topic's name. `scripts/clear-fallback-links.mjs` lists topics holding raw results stored under the older one-word rule and, with `--apply`, resets them so the next branch load searches again. A specialized topic that only one paper uses gets no search: it is marked `skipped`, and its cards lead with Explain with AI. Links are stored on the topic, so every later paper that needs it gets them free. Topics are marked `loading` with a timestamp before any paid call, which keeps two readers from paying twice. A mark older than five minutes is treated as stale.

Record writes are queued in the checkpoint and flushed 20 per tick, so no tick approaches the Worker subrequest limit. A failing step is retried once after three seconds. A second failure marks the paper failed with a message, and the requester can retry it. A verify call that fails twice leaves the overview unchecked instead of failing the paper.

The paper record keeps `timings`, the start and end (ms) of the queue wait and of each stage in the latest run, and `retries`, the number of steps that run retried. A stage's span is the time the record showed it, so a retried step's wait counts toward its stage. `stageDurations()` in `src/lib/timings.ts` turns them into per-stage and total durations, both for the progress view and for reviewing stored runs.

While a paper is analyzed, the paper window shows a progress view (`src/components/paper/AnalysisProgress.tsx`) in place of the graph: a sheet whose motion follows the stage, a checklist of the five stages with their times, and branch nodes that join one at a time as concept records arrive. A failed run shows its error and Retry. When the paper turns ready, the view fades out over the paper window.

## Knowledge

Each concept has its own checkmark, stored per reader in `concept_knowledge` (one row per concept, with the concept's name, topic and paper copied in). Checking a concept never checks anything in another paper. Instead, a concept the reader hasn't checked shows a muted note when they checked a concept with the same topic or the same normalized name in another paper ("You checked this in <paper>"), or when its topic is in their profile ("In your profile"). The profile is the `knowledge` collection: topics the reader declared known on the knowledge page, from the starter list or by search. Rows written before per-concept knowledge existed are read as profile topics. The sequence, branch and paper progress read only the current paper's checkmarks. Finishing a paper can check its remaining concepts, for that paper only. Signed out, checkmarks stay in memory and there are no hints.

## Data model

| Collection | Contents | Read | Write |
| --- | --- | --- | --- |
| `papers` | arXiv metadata, status and stage, stage timings and retries, branches, main contribution, distinct topic keys, text source, pipeline version, what verify dropped, concepts left without a quote | everyone | server only |
| `topics` | shared vocabulary: name, level, description, cached links and their loading state (`skipped` for a paper-only specialized topic) | everyone | server only |
| `concepts` | per-paper concept: topic, branch, quote (and its LaTeX display), dependencies, tier, plain role, cached explanation. Older rows may still carry a `check` question, which nothing reads | everyone | server only |
| `sections` | per-paper walkthrough entries | everyone | server only |
| `knowledge` | the reader's profile: one row per topic they declared known. It only produces hints | owner | owner |
| `concept_knowledge` | one row per concept the reader checked: concept id, paper, concept name, topic key, source, and `stale` when a re-analysis found no matching concept | owner | owner |
| `roadmaps` | papers the reader opened, last opened, finished | owner | owner |
| `workspaces` | name, description, papers (each active or finished), last opened paper, suggestions | owner | owner |
| `usage_events` | metered actions for the daily caps. An `analyze` event also records who requested a paper | admin | server only |

Owner rows use a `userBound` `userId` column with `uniqueOn` so a client cannot write another reader's row or create duplicates.

## Server actions

| Action | What it does | Limit |
| --- | --- | --- |
| `peekPaper` | look up an arXiv link or id and report its title, category, a suggested workspace name and whether it is analyzed | none (signed in) |
| `analyzePaper` | start or open an analysis, and add it to a workspace given by `workspaceId` or created from `newWorkspace: { name }` | 5 new papers per user per rolling 24 hours. Cached papers are free and a failed analysis is refunded |
| `retryPaper` | restart a failed or stuck analysis | requester or owner only, uses a daily slot |
| `reanalyzePaper` | re-run the analysis of a paper with the current pipeline, keeping topics, profiles and checkmarks (moved to the new concepts) | app owner only, no slot. Also the `reanalyze_paper` agent tool |
| `loadBranchResources` | load explainer links for one branch's topics that have none | 20 branch loads per user per 24 hours. Cached topics are free |
| `myAllowance` | the caller's remaining allowances | none |
| `recommendPapers` | Exa search restricted to arxiv.org, one Haiku ranking call, every pick verified with the arXiv API. `starter` mode asks for introductory or survey papers, and `next` (the default) also uses the reader's known topics | 10 runs per user per 24 hours |
| `explainConcept` | one Haiku explanation with a worked example, cached on the concept | 30 uncached explanations per user per 24 hours |
| `seedTopics` | create missing starter topics, 20 per call | none (idempotent) |

The owner can start a re-analysis from the CLI, with `{"arxivId": "1706.03762"}` in `input.json`:

```bash
npx deepspace agent invoke schema reanalyze_paper --input-file input.json --json
```

All integrations are billed to the app owner. Paid calls happen only in server actions and the analyze job: the browser proxy at `/api/integrations` refuses owner-billed integrations, and only the owner can enqueue jobs over the job-room socket.

## Development

```bash
npm install
npx deepspace dev start      # local runtime on port 5173
npx deepspace test run all   # unit, smoke, api and e2e suites
npx deepspace deploy
```

The Playwright suite needs two test accounts (`npx deepspace test accounts create`). In local test runs (`ALLOW_DEBUG_ROUTES=true`), papers with ids starting `0000.` and workspaces named `[fixture] ...` get canned arXiv HTML, CloudConvert, Claude, Exa and arXiv responses from `src/server/pipeline/fixtures.ts`. Fixture ids ending in 66, 77 or 99 have no HTML and take the PDF path, and ids ending in 55 answer each call after four seconds, which keeps every stage on screen long enough to watch the progress view. Ids ending in 44 get a title too long for one line on a phone, for the 390px layout checks. The file's header lists which server rule each fixture concept exercises. Everything else, including the actions, the job, the record rooms and permissions, runs for real.

`tests/live` holds a check against the deployed app with real integration calls. It is not part of `test run` and costs credits:

```bash
LIVE_PAPER=2611.29224 npx playwright test -c tests/live/playwright.live.config.ts
```

## Cost

100 credits are one US dollar. Analyzing a new paper costs four Haiku calls, plus one more overview and verify call when the overview is rewritten. Re-analyzing 8 papers of 10 to 62 pages cost 21.5 credits for 10 runs, about 2.2 credits a paper. CloudConvert (2.3 credits) is paid only for a paper with no arXiv HTML. A verify call on a 12,000-character excerpt cost about 0.3 credits in testing. Explainer links are paid only when a reader loads a branch: about 0.9 credits per Exa search, one search per topic that has no links yet, plus a small Haiku call. Before links became lazy, a 10-page paper cost about 21 credits and a 62-page paper about 16, nearly all of it Exa searches for every topic. Links are cached per topic, so branches that share topics with earlier papers cost less or nothing.

## Demo data

The signed-out demo at `/p/1706~03762` and the example on the landing page use a real analysis of arXiv 1706.03762. `tests/live/demo-paper.check.ts` builds it on the deployed app (it analyzes the paper, loads every branch's links and pre-generates a few explanations, and anything cached is free), and `scripts/export-demo-snapshot.mjs` writes the trimmed snapshot the static landing page bundles:

```bash
npx playwright test -c tests/live/playwright.live.config.ts demo-paper
node scripts/export-demo-snapshot.mjs 1706.03762
```

Both read the deployed app through the owner's CLI login (`npx deepspace agent invoke`).

## Maintenance

Papers analyzed before pipeline version 2 used the PDF text and an older topic rule. `reanalyzePaper` brings a paper up to date. `scripts/remap-topics.mjs` applies the topic-reuse rule to older papers without re-analyzing them: it moves each concept whose name shares no content word with its topic's name to a topic named for the concept, and skips version 2 papers. It prints the plan, and writes only with `--apply`:

```bash
node scripts/remap-topics.mjs schema
node scripts/remap-topics.mjs schema --apply
```
