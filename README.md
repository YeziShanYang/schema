# Schema

Now live at https://schema.app.space!

## The problem

Research papers are written for people who already have comprehensive domain knowledge. For beginners looking to get into the field, they are daunting: full of jargon and difficult to read. Example: *Attention Is All You Need*, the paper that introduced the Transformer, is 15 pages long. To follow it, readers need knowledge of softmax, word embeddings, recurrent networks, residual connections, layer normalization, BLEU scores and the Adam optimizer among other highly technical concepts. Each of those terms leads to another paper that assumes a few more.

A student in their first machine learning course, an engineer reading a paper behind a tool they use, or a researcher coming from a neighboring field has no idea where to begin. They can't tell which terms this paper depends on, or which to learn first. They end up spending hours on background that may or may not be what the paper needs, or reading to the end without following the argument.

Summaries and chat assistants only help with part of this. A summary says what the paper found, but the reader still can't follow the steps that got there. A chat assistant explains whatever it's asked about, so the reader has to already know what to ask and in what order. And when the reader moves on to the next paper in the same field, the assistant doesn't know or keep track of what they learned from the last one.

## What Schema does

Schema reads the paper first and gives the reader that map. Paste an arXiv link, and within one to two minutes Schema lists all of the concepts the paper relies on, from the foundations a newcomer needs up to the paper's own ideas. It groups them into branches and orders them so prerequisites come first. Here's how it works:

- Right off the bat, an overview explains the paper intuitively in plain language and says where each concept fits in it. Another walkthrough goes through the paper section by section if that's how you learn better.
- Branches are displayed as cards numbered in the recommended order. A step strip and a Next up button point to the first unchecked concept whose prerequisites are all checked, so you always know where to go next.
- Each concept card says why the paper needs the concept and quotes the passage where the paper uses it. Every quote is checked against the paper's text before it is shown. (+ math support!)
- Opening a branch loads explainer links found on the web for its concepts. Any concept can also get an AI explanation with a worked example, written from the paper's text around that concept (beta).
- The reader checks off what they already know. Checkmarks belong to one paper, but when a later paper uses the same idea, its card says "You checked this in …". The Knowledge page lists every checked concept by paper, and marking a paper finished can check its remaining concepts.
- To organize your papers, Workspaces group them by subject, class or topic (ex. CS 229, Climate Science). If you just want to get into a new topic, a new workspace suggests three starter papers, and later suggestions also look at what the reader has checked. The Library lists every paper the reader has opened, in progress or finished.
- Each paper is analyzed once for everyone. The next reader who opens it gets the roadmap at once and at no cost, and paper pages can be read and shared without an account.

Schema works with arXiv papers only. Each account can start five new analyses per rolling 24 hours, and opening a paper someone already analyzed is free!

## How it works

Schema is a [DeepSpace](https://docs.deep.space) app. It runs as one Cloudflare Worker, deployed with `npx deepspace deploy`, and keeps its data in DeepSpace's Durable Objects. It uses these parts of the SDK:

- Server actions (`src/actions/index.ts`, called at `POST /api/actions/:name`) do anything that costs credits or writes shared records. They run with RBAC off, and each one checks sign-in, ownership and the daily caps itself.
- A background job (`JobRoom`, `src/jobs.ts`) runs the analysis, because it runs longer than one request should. The job works in short ticks and saves a checkpoint with `ctx.continue` after each one. After a restart it picks up from the last checkpoint. Readers start a job only through `analyzePaper`, and only the owner can enqueue one over the job room's socket.
- Integrations go through `ctx.integrations.call` and are billed to the app owner. Schema calls `anthropic/chat-completion` with Claude Haiku 5.5, `exa/search` and `cloudconvert/convert-file`. The browser's integration proxy refuses owner-billed integrations, so paid calls can only come from the server.
- Records (`RecordRoom`) hold everything else, with permissions per collection in `src/schemas/`. Analysis results are readable by everyone and written only by the server. A reader's checkmarks, workspaces and opened papers are visible only to that reader, and `userBound` with `uniqueOn` stops a client from writing someone else's rows or duplicates. `useQuery` keeps the views subscribed over a WebSocket, and the progress view redraws as the job writes concepts.
- The job stores each paper's extracted text with app file storage (`appFiles`), and AI explanations read it back from there.
- Sign-in uses DeepSpace auth in mixed mode. The landing page and paper pages work signed out, and checkmarks and workspaces need an account.
- The owner can re-run an analysis with the `reanalyze_paper` agent tool (`src/ai/`) through `npx deepspace agent invoke`.
- `npx deepspace test run` runs the Playwright and unit suites against a local runtime with two test accounts.

## Technical details below!

| Step | Runs in | Outside calls | Stored in |
| --- | --- | --- | --- |
| Look up the link | `peekPaper` action | arXiv API (free) | nothing |
| Start the analysis, or open the cached one | `analyzePaper` action, which checks the daily cap and enqueues the job | arXiv API (free) | `papers`, `usage_events` |
| Get the text | job, `text` step | the arXiv HTML page (free). `cloudconvert/convert-file` only when a paper has no HTML | `appFiles` |
| List the concepts | job, `concepts` step | one Haiku call. Server rules then clean the dependency graph, branches, topics and quotes | `concepts`, `topics`, `papers` |
| Write the overview | job, `overview` step | one Haiku call | `papers`, `concepts` |
| Write the walkthrough | job, `explain` step | one Haiku call | `sections` |
| Check the overview | job, `verify` step | one Haiku call, plus a rewrite and a second check when too much fails | `papers`, `concepts` |
| Move earlier checkmarks to the new concepts | job, `remap` step | none | `concept_knowledge` |
| Show progress | `AnalysisProgress.tsx` in the browser | none | reads `papers` and `concepts` live |
| Load explainer links | `loadBranchResources` action, when a branch opens | one `exa/search` per topic without links, then Haiku picks one or two results | `topics`, shared by every paper that uses the topic |
| Explain a concept | `explainConcept` action | one Haiku call with the paper text around the quote | `concepts` |
| Check off a concept | the browser, through `useMutations` | none | `concept_knowledge`, owner only |
| Suggest papers | `recommendPapers` action | one `exa/search` limited to arxiv.org, one Haiku ranking call, then the arXiv API confirms each pick | `workspaces` |

The job writes at most 20 records per tick to stay under the Worker's subrequest limit, and retries a failed step once before marking the paper failed. The ten papers analyzed in production took 52 to 120 seconds each. A new paper costs four Haiku calls, about 2.2 credits (100 credits are one US dollar). [Analysis pipeline in detail](#analysis-pipeline-in-detail) has the rules each step applies, and [Cost](#cost) has the full numbers.

Output quality was scored on ten criteria for eight papers from eight fields. Five of the papers were posted after the model's training data. [docs/quality-evaluation.md](docs/quality-evaluation.md) has the rubric, the scores and what changed between evaluations, and [docs/build-and-verification.md](docs/build-and-verification.md) covers how the build was tested.

## Repository layout

Two files are good places to start reading: `src/server/pipeline/run.ts` runs the analyze job step by step, and `src/components/paper/PaperWindow.tsx` draws the paper page. Data access is in the hooks in `src/hooks` and the modules in `src/lib`, and views can be redesigned without touching the backend.

- `src/` is the app.
  - `src/actions/` has the server actions (`analyzePaper`, `loadBranchResources` and the others), called at `POST /api/actions/:name`.
  - `src/ai/` defines the agent tools served over HTTP and MCP, among them the owner's `reanalyze_paper`, and the routes of the in-app assistant.
  - `src/components/` holds the React components. The paper page's parts are in `paper/`, the floating graph and branch panel in `graph/`, and shared primitives in `ui/`.
  - `src/data/` is the bundled snapshot of the demo paper that the landing page shows.
  - `src/hooks/` holds the React hooks that give the views their records.
  - `src/lib/` holds the logic the views and the Worker import, with no React in it. General helpers such as arXiv id parsing, the daily cap and the server-action client sit at its root.
    - `src/lib/analysis/` has the paper text and content rules: HTML-to-text conversion, quote checks and fallbacks, math parsing, the depth rule, when a plain role shows, and the stage timings of an analysis.
    - `src/lib/graph/` cleans the concept graph and its branches (merging, placement, progress), computes the recommended sequence, and places the cards of the floating graph so they stay on screen.
    - `src/lib/knowledge/` holds the topic vocabulary, explainer link titles, the hints on unchecked concepts, and the remaps that move concepts to new topics and checkmarks to new concepts.
  - `src/pages/` holds the routes and their layouts, one file per route (file-based routing).
  - `src/schemas/` defines the collections and their permissions, and `src/schemas.ts` lists them for the SDK.
  - `src/server/` runs only in the Worker. `pipeline/` is the analyze job, and the other files hold the routes `worker.ts` registers and the work behind explainer links, explanations, overviews, recommendations, re-analysis and usage caps.
  - The files at the top of `src/` include the modules the SDK and the build look for by name (`main.tsx`, `jobs.ts`, `cron.ts`, `schemas.ts` and others), the record types in `types.ts`, and the theme.
- `tests/` has the Playwright specs (`*.spec.ts`) that `npx deepspace test run` runs. Unit tests sit next to their source. Two folders hold checks that `test run` leaves out:
  - `tests/live/` checks the deployed app with real, billed integration calls.
  - `tests/screens/` captures screenshots of every screen and of the progress view for visual review.
- In `scripts/`, `agent.mjs` calls the deployed app's agent tools through the CLI as the owner, and `export-demo-snapshot.mjs` writes `src/data/demo-snapshot.json`. `scripts/migrations/` holds one-time data migrations for papers analyzed under older rules.
- `public/` is served as it is: the favicon, `robots.txt` and `_headers`.
- `docs/` explains how output quality was measured ([quality-evaluation.md](docs/quality-evaluation.md)) and how the build was checked ([build-and-verification.md](docs/build-and-verification.md)).

At the repository root, `worker.ts` assembles the Worker's routes and Durable Objects, `prerender.ts` prerenders the landing page at build time, and `wrangler.toml` and the Vite, Vitest and ESLint configs set up deploys, builds, unit tests and lint.

## Interface

The sidebar starts with Add and links to Home, Library and Knowledge, and the Knowledge link shows how many concepts the reader has checked. Workspaces and recent papers follow. A page header carries only its title, because the highlighted sidebar link already names the page. Home has no header bar, and its only heading is for screen readers. Below 768px the sidebar opens from a menu button, so Home shows its own Add button at the top of the page.

A workspace page shows its papers as cards floating around the workspace name. Recommended papers appear as dashed cards with an Add button. A paper page shows its branches the same way, numbered in the recommended order. Clicking a branch opens a centered panel with that branch's concepts, and the branch's explainer links load when the panel opens. A toggle switches the paper page to the section walkthrough. Below 640px the cards stack in a list, and with reduced motion they hold still instead of drifting.

The Library lists the reader's papers. A paper is in it when it is in one of the reader's workspaces, when the reader saved it, or when they started on it (checked a concept, read the overview or marked it finished) and never removed it. `src/lib/membership.ts` holds the rule and its unit tests. Opening a paper doesn't add it, and only records it in Recent papers and Home's Continue. One placement control saves or unsaves a paper, adds it to or takes it out of any number of workspaces, creates a workspace for it, and removes it from the Library after a confirm that names its workspaces. Removing keeps the checkmarks. The control is in the paper page header, on each Library row beside links to the workspaces holding that paper, and in the constellation's selection panel, where it adds every selected paper to a workspace and saves them. The status, topic and workspace filters combine, and the sort, topic, workspace (`?ws=<id>`, or `?ws=none` for papers in no workspace) and view are kept in the URL. Below 640px the list is all the Library shows. On wider screens a Constellation view draws the same filtered papers as cards linked to the topics they share, with checked topics in green, and selecting cards lists the topics that connect them.

`recommendedSequence()` in `src/lib/graph/sequence.ts` orders branches by the mean prerequisite tier of their concepts, keeping the model's order on ties. Concepts are ordered by tier, then branch, then the model's order. The next concept is the first unchecked one whose dependencies are all checked. The paper page shows the steps and a Next up button, and the workspace page names the paper to continue with its next concept. A step's label is cut at about 24 characters, and the branch's full name is its tooltip and accessible name.

The Add button opens one window for papers and workspaces. For a paper, `peekPaper` looks up the link on arXiv and reports whether the paper is already analyzed. The reader then picks an existing workspace (the one opened last is preselected) or a new one, with a name suggested from the arXiv category. A paper that already exists can also open without a workspace, since that costs nothing, and opening it that way doesn't save it in the Library. A new workspace is created only after the paper checks out. The workspace form can also add papers from the Library, picked from a searchable checklist. A workspace created from this window asks `recommendPapers` once: for starter papers when it is empty, and in `next` mode when it was created with papers. Home's paper box runs the same look-up: a paper that exists opens at once and uses no daily slot, and a new one opens this window with the link and its look-up filled in.

The frontend uses the Blueprint theme (IBM Plex, dot-grid canvas) in light and dark. Dark mode follows the system setting until the reader picks one with the sun/moon button, which sits in the sidebar footer, or in the top bar when signed out. The choice is stored in the browser, and an inline script in `index.html` applies it before first paint, on the prerendered landing too. The dark values in `src/themes.css` keep each light token's hue at a different lightness. The paper sheets on the landing and in the progress view stay paper-colored in dark mode, dimmed, with dark ink.

## Analysis pipeline in detail

`analyzePaper` (a server action) validates the arXiv id, returns the cached analysis if anyone has analyzed the paper before, checks the caller's daily cap, confirms the paper exists with the arXiv API, and enqueues an `analyze` background job. The job (`src/server/pipeline/run.ts`) runs in short checkpointed ticks:

1. Seed the starter topics if they are missing, and clear the concepts and sections of an earlier analysis.
2. Get the text. The job fetches `https://arxiv.org/html/<id>` (one request with a generic User-Agent, retried once after a 429) and converts it with `src/lib/analysis/paper-html.ts`: every formula becomes its LaTeX `alttext` between `\(` and `\)`, or `\[` and `\]` for display math, and the bibliography, appendices, footnotes and page chrome are dropped. Only when there is no HTML, or it yields under 4,000 characters, does `cloudconvert/convert-file` convert the PDF, and then the text is cut at the References heading. Either way the text is capped at 90,000 characters and stored with `appFiles`, and the paper records `textSource` (`html` or `pdf`). PDF text often loses roots, fractions and exponents, so every prompt that reads it is told not to trust its formulas.
3. One Claude Haiku 5.5 call lists the concepts the paper relies on (10 to 18, or up to 24 for text over 40,000 characters), starting with the general foundations a newcomer to the field needs, with up to two candidate quotes, dependencies, depth, a branch and a topic. The server then applies its rules:
   - Dangling dependencies are dropped, cycles broken and tiers computed.
   - A branch with one concept merges into the branch holding most of its dependency neighbours, or into "Other concepts" (`src/lib/graph/branch-merge.ts`).
   - When the branches then depend on each other in a circle, which would make the recommended sequence fall back to the model's order, misfiled concepts move (`src/lib/graph/branch-placement.ts`): a tier-0 concept that an earlier branch uses goes to the earliest such branch, and a concept whose prerequisites outside its branch all lie in later branches goes to the latest of those. A move is kept only when it lowers the number of dependencies pointing to a later branch and leaves its branch with at least two concepts. Each move is logged.
   - A concept may reuse an existing topic only when the two names share a content word, ignoring stop words, plurals and generic head nouns such as "score" or "matrix". Otherwise it gets a topic named for itself (`sharesContentWord` in `src/lib/knowledge/topics.ts`). The prompt lists up to 150 existing topics with short descriptions, foundation and core first.
   - The quote is the first candidate that is found in the paper text, has at least 8 words, contains no `=` or display math, doesn't end in a lead-in ("is", "the", "as follows", a colon, an equation reference such as "(9)"), has its brackets closed and isn't another concept's quote (`src/lib/analysis/quote-rules.ts`). The text right after the quote is checked too: a quote that stops where its sentence goes on into a formula, a colon, its main clause or its verb is carried on to the end of the sentence if the longer quote passes the same rules, and rejected otherwise. A quote that stops inside a bracket is carried on the same way.
   - A concept whose candidates all fail takes the first sentence of the paper text that contains its name, its topic's name, an abbreviation of either, or a shorter form of either (such as "Bellman recursion" for "Bellman recursion for a priced query"), and that passes the same rules (`src/lib/analysis/quote-fallback.ts`). Sentences with two or more citations, or that open by referring to the sentence before, are skipped. A concept with no such sentence shows no quote, and the paper records how many concepts ended without one in `conceptsWithoutQuote`. On the HTML path a quote with math is shown through KaTeX as it stands.
4. One Haiku call writes the plain-language overview (summary, story and a plain role per concept). Its prompt forbids unexplained terms in the story's plain sentences. A concept with no plain role shows no "Where it fits" line; its card already shows the why-needed line.
5. One Haiku call writes the section walkthrough.
6. The `verify` stage: one Haiku call reads the abstract, the first 12,000 characters, each concept's quote and the overview, and judges every story sentence, technical line and plain role (`src/server/pipeline/verify.ts`). An unsupported technical line, plain role or story sentence is dropped, while at least four sentences remain. If fewer would remain, or the summary itself is unsupported, the overview is written once more with the problems as feedback and checked again. Sentences flagged for unexplained jargon are logged and passed to that rewrite, but never dropped, because the judge flags everyday words ("GPUs") and dropping cut the end of the story. The paper records what was dropped in `overviewDropped`.
7. Readers' checkmarks from an earlier analysis of the paper move to the new concepts with the same normalized name (`src/lib/knowledge/knowledge-remap.ts`). A checkmark with no match stays, marked stale.
8. The paper is marked ready with `pipelineVersion: 2`.

Explainer links are not part of the job. When a reader opens a branch and asks for links, `loadBranchResources` runs one `exa/search` per topic in that branch that has no links yet, then one Haiku call per five topics picks one or two results. A topic the pick finds nothing for keeps an empty list. Raw search results are used only when the pick call fails, and only those whose title shares at least two content words with the topic's name. `scripts/migrations/clear-fallback-links.mjs` lists topics holding raw results stored under the older one-word rule and, with `--apply`, resets them so the next branch load searches again. A specialized topic that only one paper uses gets no search: it is marked `skipped`, and its cards lead with Explain with AI. Links are stored on the topic, so every later paper that needs it gets them free. Topics are marked `loading` with a timestamp before any paid call, which keeps two readers from paying twice. A mark older than five minutes is treated as stale.

Record writes are queued in the checkpoint and flushed 20 per tick, so no tick approaches the Worker subrequest limit. A failing step is retried once after three seconds. A second failure marks the paper failed with a message, and the requester can retry it. A verify call that fails twice leaves the overview unchecked instead of failing the paper.

The paper record keeps `timings`, the start and end (ms) of the queue wait and of each stage in the latest run, and `retries`, the number of steps that run retried. A stage's span is the time the record showed it, so a retried step's wait counts toward its stage. `stageDurations()` in `src/lib/analysis/timings.ts` turns them into per-stage and total durations, both for the progress view and for reviewing stored runs.

While a paper is analyzed, the paper window shows a progress view (`src/components/paper/AnalysisProgress.tsx`) in place of the graph: a sheet whose motion follows the stage, a checklist of the five stages with their times, and branch nodes that join one at a time as concept records arrive. A failed run shows its error and Retry. When the paper turns ready, the view fades out over the paper window.

## Knowledge

Each concept has its own checkmark, stored per reader in `concept_knowledge` (one row per concept, with the concept's name, topic and paper copied in). Checking a concept never checks anything in another paper. Instead, a concept the reader hasn't checked shows a muted note when they checked a concept with the same topic or the same normalized name in another paper ("You checked this in <paper>"), or when its topic is in their profile ("In your profile"). The profile is the `knowledge` collection: topics the reader declared known on the knowledge page, from the starter list or by search. Rows written before per-concept knowledge existed are read as profile topics. The sequence, branch and paper progress read only the current paper's checkmarks. Finishing a paper can check its remaining concepts, for that paper only, and Read again then offers to uncheck the ones it checked (rows with source `finished`). The knowledge page lists checked concepts by paper, and each paper's group can uncheck all of them after a confirm. A reader with nothing checked and an empty profile sees the starter topics first. Signed out, checkmarks stay in memory and there are no hints.

## Data model

| Collection | Contents | Read | Write |
| --- | --- | --- | --- |
| `papers` | arXiv metadata, status and stage, stage timings and retries, branches, main contribution, distinct topic keys, text source, pipeline version, what verify dropped, concepts left without a quote | everyone | server only |
| `topics` | shared vocabulary: name, level, description, cached links and their loading state (`skipped` for a paper-only specialized topic) | everyone | server only |
| `concepts` | per-paper concept: topic, branch, quote (and its LaTeX display), dependencies, tier, plain role, cached explanation. Older rows may still carry a `check` question, which nothing reads | everyone | server only |
| `sections` | per-paper walkthrough entries | everyone | server only |
| `knowledge` | the reader's profile: one row per topic they declared known. It only produces hints | owner | owner |
| `concept_knowledge` | one row per concept the reader checked: concept id, paper, concept name, topic key, source, and `stale` when a re-analysis found no matching concept | owner | owner |
| `roadmaps` | one row per paper the reader opened, saved or filed: last opened (the history behind Recent papers and Continue), finished, overview read, and `savedAt` for the Library, which is missing when the reader never decided, a time when saved and 0 when removed. Rows from before `savedAt` read as missing | owner | owner |
| `workspaces` | name, description, papers (each active or finished), last opened paper, suggestions | owner | owner |
| `usage_events` | metered actions for the daily caps. An `analyze` event also records who requested a paper | admin | server only |

Owner rows use a `userBound` `userId` column with `uniqueOn` so a client cannot write another reader's row or create duplicates.

## Server actions

| Action | What it does | Limit |
| --- | --- | --- |
| `peekPaper` | look up an arXiv link or id and report its title, category, a suggested workspace name and whether it is analyzed | none (signed in) |
| `analyzePaper` | start or open an analysis, and add it to a workspace given by `workspaceId` or created from `newWorkspace: { name }`, which also saves it in the reader's Library | 5 new papers per user per rolling 24 hours. Cached papers are free and a failed analysis is refunded |
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

## Development

```bash
npm install
npx deepspace dev start      # local runtime on port 5173
npx deepspace test run all   # unit, smoke, api and e2e suites
npx deepspace deploy
```

The Playwright suite needs two test accounts (`npx deepspace test accounts create`). In local test runs (`ALLOW_DEBUG_ROUTES=true`), papers with ids starting `0000.` and workspaces named `[fixture] ...` get canned arXiv HTML, CloudConvert, Claude, Exa and arXiv responses from `src/server/pipeline/fixtures.ts`. Fixture ids ending in 66, 77 or 99 have no HTML and take the PDF path, and ids ending in 55 answer each call after four seconds, which keeps every stage on screen long enough to watch the progress view. Ids ending in 44 get a title too long for one line on a phone, for the 390px layout checks, and ids ending in 33 get five branches with long names, for the step strip at 1440px. The file's header lists which server rule each fixture concept exercises. Everything else, including the actions, the job, the record rooms and permissions, runs for real.

`tests/live` holds checks against the deployed app with real integration calls. They are not part of `test run` and cost credits:

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

Papers analyzed before pipeline version 2 used the PDF text and an older topic rule. `reanalyzePaper` brings a paper up to date. `scripts/migrations/remap-topics.mjs` applies the topic-reuse rule to older papers without re-analyzing them: it moves each concept whose name shares no content word with its topic's name to a topic named for the concept, and skips version 2 papers. It prints the plan, and writes only with `--apply`:

```bash
node scripts/migrations/remap-topics.mjs schema
node scripts/migrations/remap-topics.mjs schema --apply
```
