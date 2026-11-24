# Schema

Schema turns an arXiv paper into a learning roadmap. A reader creates a workspace for a subject (for example "CS 229"), gets three recommended papers or pastes their own, and the app lists every concept the chosen paper relies on. Concepts are grouped into 3 to 6 thematic branches and ordered by prerequisite. Each one comes with the passage where the paper uses it, explainers found on the web, a check question and an optional AI explanation. What the reader knows is stored in a knowledge profile that carries over to later papers.

Live at https://schema.app.space. Built on the [DeepSpace SDK](https://docs.deep.space) (Cloudflare Workers, Durable Objects).

The frontend in this repository is a minimal functional layer over the data hooks in `src/hooks` and the modules in `src/lib`.

## How a paper is analyzed

`analyzePaper` (a server action) validates the arXiv id, returns the cached analysis if anyone has analyzed the paper before, checks the caller's daily cap, confirms the paper exists with the arXiv API, and enqueues an `analyze` background job. The job (`src/server/pipeline/run.ts`) runs in short checkpointed ticks:

1. Seed the starter topics if they are missing.
2. Convert the PDF with `cloudconvert/convert-file` (URL input), cut the text at the References heading, cap it at 90,000 characters and store it with `appFiles` so a retry does not convert again.
3. One Claude Haiku 5.5 call lists the concepts the paper relies on, from foundations up, with a quote, dependencies, depth, a branch and a topic in the shared vocabulary. The server drops dangling dependencies, breaks cycles, computes tiers and checks every quote against the paper text.
4. For each topic that has no resources yet, one `exa/search` call, then one Haiku call per batch of five topics picks one or two results. Resources are stored on the topic and reused by every later paper.
5. One Haiku call writes the section walkthrough and a check question per concept.

Record writes are queued in the checkpoint and flushed 20 per tick, so no tick approaches the Worker subrequest limit. A failing step is retried once after three seconds; a second failure marks the paper failed with a message, and the requester can retry it.

The concept list does not depend on the reader. Readers mark what they already know, and progress (per paper and per branch) is computed from their knowledge profile.

## Data model

| Collection | Contents | Read | Write |
| --- | --- | --- | --- |
| `papers` | arXiv metadata, status and stage, branches, main contribution | everyone | server only |
| `topics` | shared vocabulary: name, level, description, cached resources | everyone | server only |
| `concepts` | per-paper concept: topic, branch, quote, dependencies, tier, check question, cached explanation | everyone | server only |
| `sections` | per-paper walkthrough entries | everyone | server only |
| `knowledge` | one row per topic the reader knows or is learning | owner | owner |
| `roadmaps` | papers the reader opened, last opened, finished | owner | owner |
| `workspaces` | name, description, current target, paper history, suggestions | owner | owner |
| `usage_events` | metered actions for daily caps | admin | server only |

Owner rows use a `userBound` `userId` column with `uniqueOn` so a client cannot write another reader's row or create duplicates.

## Server actions

| Action | What it does | Limit |
| --- | --- | --- |
| `analyzePaper` | start or open an analysis; with `workspaceId`, also set it as that workspace's target | 5 new papers per user per rolling 24 hours (cached papers are free) |
| `retryPaper` | restart a failed or stuck analysis | requester or owner only |
| `recommendPapers` | Exa search restricted to arxiv.org, one Haiku ranking call, every pick verified with the arXiv API | 10 runs per user per 24 hours |
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

The Playwright suite needs two test accounts (`npx deepspace test accounts create`). In local test runs (`ALLOW_DEBUG_ROUTES=true`), papers with ids starting `0000.` and workspaces named `[fixture] ...` get canned CloudConvert, Claude, Exa and arXiv responses from `src/server/pipeline/fixtures.ts`. Everything else, including the actions, the job, the record rooms and permissions, runs for real.

`tests/live` holds a check against the deployed app with real integration calls. It is not part of `test run` and costs credits:

```bash
LIVE_PAPER=2611.29224 npx playwright test -c tests/live/playwright.live.config.ts
```

## Cost per paper

Measured on the deployed app: about 21 credits for a 10-page paper (17 concepts, 18 Exa searches) and about 16 credits for a 62-page paper (15 concepts), where 100 credits are one US dollar. Exa searches are most of it at roughly 0.9 credits each; CloudConvert is 2.3 credits per paper and the Haiku calls about 2 to 3 credits. Because resources are cached per topic, later papers that share topics cost less.
