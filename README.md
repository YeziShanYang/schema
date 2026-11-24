# Schema

Schema turns an arXiv paper into a learning roadmap. A reader creates a workspace for a subject (for example "CS 229"), adds papers to it from three recommendations or by pasting a link, and the app lists every concept each paper relies on. Concepts are grouped into 3 to 6 thematic branches and ordered by prerequisite. Each one comes with the passage where the paper uses it, explainers found on the web, a check question and an optional AI explanation. What the reader knows is stored in a knowledge profile that carries over to later papers.

Live at https://schema.app.space. Built on the [DeepSpace SDK](https://docs.deep.space) (Cloudflare Workers, Durable Objects).

The frontend uses the Blueprint theme (IBM Plex, dot-grid canvas). Data access is in the hooks in `src/hooks` and the modules in `src/lib`, and views can be redesigned without touching the backend.

## Interface

A workspace page shows its papers as cards floating around the workspace name. Recommended papers appear as dashed cards with an Add button. A paper page shows its branches the same way, numbered in the recommended order. Clicking a branch opens a centered panel with that branch's concepts, and the branch's explainer links load when the panel opens. A toggle switches the paper page to the section walkthrough. Below 640px the cards stack in a list, and with reduced motion they hold still instead of drifting.

`recommendedSequence()` in `src/lib/sequence.ts` orders branches by the mean prerequisite tier of their concepts, keeping the model's order on ties. Concepts are ordered by tier, then branch, then the model's order. The next concept is the first one the reader doesn't know whose dependencies are all known or being learned. The paper page shows the steps and a Next up button, and the workspace page names the paper to continue with its next concept.

The Add button opens one window for papers and workspaces. For a paper, `peekPaper` looks up the link on arXiv and reports whether the paper is already analyzed. The reader then picks an existing workspace or a new one, with a name suggested from the arXiv category. A new workspace is created only after the paper checks out. A workspace created from this window asks `recommendPapers` for starter papers once.

## How a paper is analyzed

`analyzePaper` (a server action) validates the arXiv id, returns the cached analysis if anyone has analyzed the paper before, checks the caller's daily cap, confirms the paper exists with the arXiv API, and enqueues an `analyze` background job. The job (`src/server/pipeline/run.ts`) runs in short checkpointed ticks:

1. Seed the starter topics if they are missing.
2. Convert the PDF with `cloudconvert/convert-file` (URL input), cut the text at the References heading, cap it at 90,000 characters and store it with `appFiles` so a retry does not convert again.
3. One Claude Haiku 5.5 call lists the concepts the paper relies on, from foundations up, with a quote, dependencies, depth, a branch and a topic in the shared vocabulary. The server drops dangling dependencies, breaks cycles, computes tiers and checks every quote against the paper text.
4. One Haiku call writes the section walkthrough and a check question per concept.

Explainer links are not part of the job. When a reader opens a branch and asks for links, `loadBranchResources` runs one `exa/search` per topic in that branch that has no links yet, then one Haiku call per five topics picks one or two results. Links are stored on the topic, so every later paper that needs it gets them free. Topics are marked `loading` with a timestamp before any paid call, which keeps two readers from paying twice. A mark older than five minutes is treated as stale.

Record writes are queued in the checkpoint and flushed 20 per tick, so no tick approaches the Worker subrequest limit. A failing step is retried once after three seconds. A second failure marks the paper failed with a message, and the requester can retry it.

The paper record keeps `timings`, the start and end (ms) of the queue wait and of each stage in the latest run, and `retries`, the number of steps that run retried. A stage's span is the time the record showed it, so a retried step's wait counts toward its stage. `stageDurations()` in `src/lib/timings.ts` turns them into per-stage and total durations, both for the progress view and for reviewing stored runs.

While a paper is analyzed, the paper window shows a progress view (`src/components/paper/AnalysisProgress.tsx`) in place of the graph: a sheet whose motion follows the stage, a checklist of the four stages with their times, and branch nodes that join one at a time as concept records arrive. A failed run shows its error and Retry. When the paper turns ready, the view fades out over the paper window.

The concept list does not depend on the reader. Readers mark what they already know, and progress (per paper and per branch) is computed from their knowledge profile.

## Data model

| Collection | Contents | Read | Write |
| --- | --- | --- | --- |
| `papers` | arXiv metadata, status and stage, stage timings and retries, branches, main contribution, distinct topic keys | everyone | server only |
| `topics` | shared vocabulary: name, level, description, cached links and their loading state | everyone | server only |
| `concepts` | per-paper concept: topic, branch, quote, dependencies, tier, check question, cached explanation | everyone | server only |
| `sections` | per-paper walkthrough entries | everyone | server only |
| `knowledge` | one row per topic the reader knows or is learning | owner | owner |
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
| `loadBranchResources` | load explainer links for one branch's topics that have none | 20 branch loads per user per 24 hours. Cached topics are free |
| `myAllowance` | the caller's remaining allowances | none |
| `recommendPapers` | Exa search restricted to arxiv.org, one Haiku ranking call, every pick verified with the arXiv API. `starter` mode asks for introductory or survey papers, and `next` (the default) also uses the reader's known topics | 10 runs per user per 24 hours |
| `explainConcept` | one Haiku explanation with a worked example, cached on the concept | 30 uncached explanations per user per 24 hours |
| `seedTopics` | create missing starter topics, 20 per call | none (idempotent) |

All integrations are billed to the app owner. Paid calls happen only in server actions and the analyze job: the browser proxy at `/api/integrations` refuses owner-billed integrations, and only the owner can enqueue jobs over the job-room socket.

## Development

```bash
npm install
npx deepspace dev start      # local runtime on port 5173
npx deepspace test run all   # unit, smoke, api and e2e suites
npx deepspace deploy
```

The Playwright suite needs two test accounts (`npx deepspace test accounts create`). In local test runs (`ALLOW_DEBUG_ROUTES=true`), papers with ids starting `0000.` and workspaces named `[fixture] ...` get canned CloudConvert, Claude, Exa and arXiv responses from `src/server/pipeline/fixtures.ts`. Fixture ids ending in 55 answer each call after four seconds, which keeps every stage on screen long enough to watch the progress view. Everything else, including the actions, the job, the record rooms and permissions, runs for real.

`tests/live` holds a check against the deployed app with real integration calls. It is not part of `test run` and costs credits:

```bash
LIVE_PAPER=2611.29224 npx playwright test -c tests/live/playwright.live.config.ts
```

## Cost

100 credits are one US dollar. Analyzing a new paper costs CloudConvert (2.3 credits) plus the Haiku calls (about 2 to 3 credits). Explainer links are paid only when a reader loads a branch: about 0.9 credits per Exa search, one search per topic that has no links yet, plus a small Haiku call. Before links became lazy, a 10-page paper cost about 21 credits and a 62-page paper about 16, nearly all of it Exa searches for every topic. Links are cached per topic, so branches that share topics with earlier papers cost less or nothing.

## Demo data

The signed-out demo at `/p/1706~03762` and the example on the landing page use a real analysis of arXiv 1706.03762. `tests/live/demo-paper.check.ts` builds it on the deployed app (it analyzes the paper, loads every branch's links and pre-generates a few explanations, and anything cached is free), and `scripts/export-demo-snapshot.mjs` writes the trimmed snapshot the static landing page bundles:

```bash
npx playwright test -c tests/live/playwright.live.config.ts demo-paper
node scripts/export-demo-snapshot.mjs 1706.03762
```

Both read the deployed app through the owner's CLI login (`npx deepspace agent invoke`).
