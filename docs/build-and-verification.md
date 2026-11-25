# Build and verification

Schema was built from 2026-11-23 to 2026-11-25. Claude Code, a coding agent, wrote the code, tests and scripts, and ran the test suites and live checks described here. Separate agent sessions that had not written the code did the independent reviews and the two quality evaluations, which [quality-evaluation.md](quality-evaluation.md) covers in detail. This page condenses the build record into five stages. Each stage lists what was built, how it was checked and what the checks found.

## Check types

- Unit tests (Vitest) and Playwright specs, run together with `npx deepspace test run all`. The later counts are from runs on fresh local state. In local runs, papers with ids starting `0000.` get canned responses for arXiv, CloudConvert, Claude and Exa, while the actions, the job, the record rooms and the permissions run for real.
- Live checks, which are Playwright scripts against the deployed app, some with real paid calls.
- Reads of production records through the DeepSpace CLI's agent tools, and the production logs.
- Offline replays, which run a new server rule over the stored text and records of production papers with no model calls.
- Screenshots at 1440 and 390 px wide, with and without reduced motion, read one at a time.
- Contrast ratios (WCAG 2) measured in the rendered page.

## Platform research and model test

Before any code, the DeepSpace docs, the SDK source (0.44.2) and 34 example apps were read. Several example apps call paid integrations from browser code, where a quota check can be skipped. Schema keeps every paid call in a server action or the background job.

A model test ran Claude Haiku 5.5 and Claude Sonnet 5.5 on four papers with the same prompt at temperature 0. On the three papers both models ran, Sonnet found 2 to 3 more relevant concepts and 1 to 2 more tiers of ordering, at 40 to 64 times Haiku's cost on the free tier (28.2 against 0.44 credits on the same trimmed paper). The prompt described a reader with no deep learning, and on the 62-page guidance paper Haiku still marked the Transformer, attention and softmax as already known. Two decisions followed. Haiku makes every model call, and concepts are extracted once per paper with no reader profile, leaving the reader to check off what they know. Cutting the text at the References heading took that paper from 80.9k to 21.1k input tokens, and in that one run Haiku no longer marked attention as known. Every quote in the test existed in the paper, and the partial matches were equations or symbols mangled by PDF extraction.

Single real calls then tested the integrations. CloudConvert converted an arXiv PDF from its URL in about 5 s, for both a short paper and the 28 MB guidance paper, with output the same size as local pdftotext and a cost of 2.34 credits each. One Exa search returned 5 relevant results for about 0.9 credits. YouTube search was left out at $0.013 a search, because Exa already returns videos.

## Pipeline

On 2026-11-23 Claude Code scaffolded the app and deployed it from the public repo. It wrote the record collections with per-role permissions and pure functions for arXiv id parsing, the References cut, quote checks, the prerequisite graph and tiers, JSON extraction and the daily cap window. On top of those came the checkpointed `analyze` job (`src/server/pipeline/run.ts`) and the server actions. Later that day the scope grew to workspaces, paper recommendations (`recommendPapers`), 3 to 6 thematic branches per paper, on-demand explanations (`explainConcept`) and a per-user cap on each paid action.

The first core had 46 unit tests and a clean `tsc`, and the scope change brought it to 57. Once fixture mode and the Playwright specs were in, 59 unit tests and 19 Playwright specs passed twice. A live check with real calls analyzed 2611.29224 on the deployed app in 132 s, with 4 branches, 17 concepts, 17 of 17 quotes verified and 6 walkthrough sections. Checkmarks survived a reload, and a second account saw the shared paper without the first account's progress. Recommendations returned three real arXiv papers, and a malformed id and the nonexistent 2611.99999 each showed a clear error. The 62-page 2611.29002 was ready in 81 s with 15 of 15 quotes verified.

Problems found and how they were fixed:

- Reading the SDK source showed that the job room increments `attempts` on every checkpoint (`ctx.continue`), so the planned `maxAttempts: 2` would have ended crash recovery after two ticks. Each step now retries once inside the job, and jobs are enqueued with `maxAttempts: 60`.
- Any member could enqueue paid analyze jobs over the job-room socket and skip the cap. Job writes are now admin only.
- The scaffold's integration proxy let any signed-in user call owner-billed integrations from the browser. It now returns 403 for them, and a curl against production confirmed it.
- Reloading `/p/2611.29224` returned `not_found`, because the scaffold's static route treats a last path segment containing "." as a file. Slugs now encode "." as "~", which is why the demo paper is at `/p/1706~03762`.
- Production logs showed the concept step once hit its 8,000-token limit (Haiku's thinking counts against it), and the walkthrough step once returned invalid JSON. Both recovered on the step retry, and the limits were raised to 16,000.
- The fuzzy quote match was replaced with a chunked `indexOf` check to keep CPU time linear inside a Worker.

## Frontend

Over 2026-11-23 and 2026-11-24 Claude Code built the Blueprint theme, an app shell with a sidebar, workspaces that hold any number of papers, and a floating graph of papers and branches. A branch opens a centered panel with a focus trap, Esc and scroll lock. Explainer links became lazy. The job no longer searches for them, and a reader loads them per branch (20 loads a day, cached topics free). `recommendedSequence()` orders the steps behind Next up. The Add window looks a link up on arXiv before it spends a daily slot, and an overview window ties each story sentence to its concepts. Formulas render with KaTeX. Usage reservations keep the daily caps exact under parallel requests, and each concept in a paper gets its own topic. A signed-out demo shows a real analysis of 1706.03762.

Unit and Playwright counts grew from 62 and 20 to 108 and 36. One API spec fires the remaining allowance plus three analyses in parallel and gets exactly the remaining number accepted. Other specs cover the refund for a failed analysis, a scanned PDF that keeps its slot, focus return after Esc, and the step strip at 1440 and 390 px. A live finish check on production with a fresh account got three starter suggestions, followed Next up, checked a concept and reloaded, then finished a paper (15 known topics afterwards) and used Read again. Screenshots were taken at 1440, 1280, 960 and 390 px. A UI checklist pass searched the code for `transition-all`, shadow rings without a border and motion not gated on reduced motion.

What the checks found:

- The CLI tool that reads production records trims large responses. It returned 9 of 14 topics and 17 of 18 concepts, which first looked like a lost concept. Scripts now query per branch and per topic.
- After a prerequisite chip switched branches, Esc stopped closing the panel because the focused element had been removed. The key handler moved to the document.
- Modal and tooltip animations still scaled and slid under reduced motion. A reduced-motion block now pins their scale and translate, and only the fade runs.
- The reduced-motion screenshots had been taken with full motion. Playwright emulates no preference unless a context sets `reducedMotion`, and that hides Chrome's own flag (checked with `matchMedia`). Each context now sets it.
- A scanned-PDF spec passed for the wrong reason, because it reused a fixture id that had already been analyzed. Specs now pick ids that `peekPaper` reports as new.
- A 45-minute-old loading mark on one topic left signed-out visitors on "Finding explainer links…" indefinitely. Cards now treat a mark older than 5 minutes as no links.

Test-account rows were later removed from production with a temporary owner-only tool that refused any other caller and any user outside the test accounts. Its dry run counted 62 rows, and the real run deleted exactly those. The shared totals (3 papers, 50 concepts, 24 sections, 60 topics) were the same before and after, and the tool was then removed and the app redeployed.

## Quality work

On 2026-11-24 each paper record gained per-stage timings and a retry count, and a progress view in the paper window follows those stages as a paper is analyzed. The landing page got a hero drawn from the demo paper. Check questions gave way to one checkmark per concept, with a hint when the reader checked the same concept in another paper. Pipeline version 2 changed where the text comes from and added quote, topic and branch rules, a verify stage for the overview and owner-only re-analysis. [quality-evaluation.md](quality-evaluation.md) lists these changes and the evaluations before and after them.

`src/server/pipeline/run.test.ts` drives the real job tick by tick against an in-memory record store, for a clean run, a retried step and a run that fails twice. The progress view was checked on local runs with each fixture call delayed 4 s, with screenshots at 1440 and 390 px. Before version 2 was merged, a spike with real calls on two papers rendered √dk and √(2/a) correctly, and the verify call flagged all three overview lines the first evaluation had marked wrong. Suites went from 168 unit and 41 Playwright to 212 and 44. All eight evaluation papers were re-analyzed on production, each ready from HTML in 67 to 130 s with no retries.

Failures and their fixes:

- The model copied `\sqrt{d_{k}}` without its math delimiters. The stored quote is now the paper's own span, widened to whole formulas.
- The topic rule refused "Layer normalization" the starter topic "Batch and layer normalization". A name made only of generic words may now reuse a topic that contains all its words.
- On the first production re-analysis the overview kept 4 of 9 sentences, because the verify stage dropped sentences flagged only for jargon. Those flags are now logged and passed to a rewrite.
- A checkmark could flicker back after a confirmed write, and a click in that gap was lost, because the optimistic state cleared before the query had the row. It now holds until the query matches, the write fails or 10 s pass.
- With 30 workspaces the sidebar list ran over Recent papers. A new spec with 30 rows fails without the fix and passes with it.

## Reviews and polish

Three reviews by fresh agents fed this stage:

- A first-time-user review (2026-11-24) used production signed out and signed in, and local fixtures for the paid flows, at 1440 and 390 px with reduced motion on and off. It found 15 bugs and 15 friction points.
- A bug and friction review (2026-11-25) ran signed out on production and signed in locally on fixtures, in light and dark. It found 6 bugs and 10 friction points and measured contrast. In one bug, "See in overview" highlighted whatever sat under a still pointer instead of the requested concept. In another, the Library offered to finish a paper whose analysis had failed.
- A content review (2026-11-25) read the output of ten papers offline. Its rules and their measured effect are in [quality-evaluation.md](quality-evaluation.md).

Each bug from the first review was reproduced before its fix, and most got a new end-to-end check. The interface changed in three rounds. Pressing Start in the overview now counts as reading it, and a Back link returns the reader after a jump to a prerequisite or to the overview. Step labels are cut at about 24 characters. Dark mode follows the system setting until the reader picks a theme, and a script applies the choice before first paint.

Contrast was measured against the card color. In dark mode, text measured 14.3:1, muted text 6.9:1, links 6.8:1, green 8.1:1, and input and checkbox edges 3.4:1. The dark primary measured 1.9:1 on the paper-colored hero sheet, so links there take a darker blue (3.7:1). Light mode had misses: green text at 4.31:1, amber at 4.20:1, the focus halo at 2.36:1, the checkbox edge at 1.86:1, faint text at 2.65:1 and input edges at 1.59:1. Commit fad90c7 changed these tokens to values that measure at least 4.5:1 for text and 3:1 for edges and the focus halo.

The first review's fixes passed 216 unit and 56 Playwright tests twice from fresh state. After the content rules and the second review's fixes were merged, 238 unit and 80 Playwright tests passed from fresh state. Paper pages had been 833 px wide on a 390 px screen. After the deploys in this stage, the landing page and the paper pages checked measured 390 px with no page errors, and at 1440 px the theme followed the system setting in light and dark.

Other findings:

- The Add window grew past a 390 px screen when a workspace had a long name, and modal titles ran under the close button. Both were fixed.
- Signed in at 1440 px, the sidebar leaves a five-step strip about 200 px short, so it scrolls behind its fade. It was left that way.
- The merged suite failed the library finish spec twice from fresh state. Finishing set the finished status before writing the remaining checkmarks, and the spec left the page as soon as the row showed finished. Since f93b6bd the app writes the checkmarks first.
- Hiding repeated plain roles also hid the "See in overview" link on that line. The link moved to the why-needed line.
- The walkthrough prompt asked for LaTeX and the model ignored it. The rule moved into the field description, and a later test on three papers found no formula outside LaTeX.

## Cost

100 credits are one US dollar. A new paper costs four Haiku calls, plus one more overview and verify call when the overview is rewritten. Re-analyzing the eight evaluation papers (10 to 62 pages) cost 21.5 credits for 10 runs, about 2.2 credits a paper. CloudConvert (2.3 credits) is paid only for a paper with no arXiv HTML. Explainer links are paid only when a reader loads a branch, at about 0.9 credits per Exa search for each topic with no links yet, plus a small Haiku call. Before links became lazy, a 10-page paper cost about 21 credits and a 62-page paper about 16, nearly all of it Exa searches.

The model test cost 83.8 credits, most of it for the three Sonnet calls. The pipeline stage's integration tests and live checks cost 44.6, and the frontend stage, including the demo paper's analysis and links, cost 17.03. The first evaluation cost 36.52, the second evaluation's link loads 18.89, the walkthrough prompt test 1.44 and the concept-count test 4.35.

## Untested areas

The last review did not cover Safari, Firefox, touch input, forced-colors mode, sign-up, email sign-in or dragging graph nodes, and the earlier checks above do not cover them either.
