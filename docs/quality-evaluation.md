# Quality evaluation

This page covers how the quality of Schema's output was measured. It describes the rubric, two scored evaluations of eight papers on 2026-11-24, the pipeline changes made between them, and the rule changes measured offline after the second one. The [README](../README.md) describes how the pipeline works today.

## Rubric

Each paper gets a score from 1 to 5 on ten criteria, and each score cites evidence from the paper and from the output.

| Criterion | What is checked |
| --- | --- |
| Coverage | The concepts the main argument depends on are present |
| Accuracy | Names, why-needed lines and plain roles are true to the paper, with no invented claims |
| Grounding | Each quote supports the concept it is attached to |
| Level | Foundations are there for a reader with little background, without trivial padding |
| Branches | Each branch is coherent and named for its theme, with none of one concept and none bloated |
| Sequence | The step order and the first Next up make sense for a learner starting from scratch |
| Overview | Plain language, accurate, in the paper's order, every concept placed, technical lines correct |
| Check questions | One correct answer that tests understanding, with a correct explanation |
| Links | Explainers fit a beginner and match the concept, with none dead or off-topic |
| Math | Formulas render, and none is mangled |

A paper passes when no criterion is below 3 and its mean is at least 4. The pipeline passes when every paper passes. Math is n/a for a paper with no formulas, and the mean then covers the other criteria.

## Papers

Three papers had been analyzed before the first evaluation. The other five come from fields the pipeline had not seen, and all five were posted after the model's training data.

| arXiv | Field | Pages |
| --- | --- | --- |
| 1706.03762 | cs.CL (the Transformer) | 15 |
| 2611.29224 | cs.LG with astronomy and geometry | 10 |
| 2611.29002 | cs.LG (guidance for autoregressive image models) | 62 |
| 2611.31236 | quant-ph (complexity theory, proof-heavy) | 17 |
| 2611.31122 | cs.CR (privacy, formal definitions) | 26 |
| 2611.30998 | econ.EM (random matrices) | 51 |
| 2611.30552 | cs.HC (applied systems, little math) | 13 |
| 2611.29886 | q-bio.NC (neuroscience, control theory) | 20 |

## Method

Claude Code built the pipeline. Each evaluation was run by a separate agent session that had not worked on it. The reviewer read each paper next to the records the deployed app stores for it and loaded explainer links for one branch per paper through the app. It then scored the rubric with quoted evidence and added automatic counts: quotes verified, quotes breaking the quote rules, topic mismatches, branch sizes and stage times.

The first reviewer read the papers as local pdftotext output, and read the proofs only through the introduction, the theorem statements and the passages the output cites.

The second reviewer read each paper from its arXiv HTML page and computed the step order with `recommendedSequence()` for a reader who knows nothing. It wrote all its scores before reading the first evaluation or the fix plan. It could not see the production log lines that record what verification dropped, and took those counts from the paper records instead. Links that refused scripted requests (HTTP 403 or a bot challenge) were scored on their titles and stored "why" lines.

Both reviewers checked math by running KaTeX offline on the stored formulas, not by viewing the cards in a browser. The two passes had different reviewers, so a one-point move with no recorded reason may be reviewer variance as much as a pipeline change.

## First evaluation

These scores belong to the pipeline before version 2, as deployed on 2026-11-24. Paper text came from the PDF through CloudConvert, and each concept had a check question. The five new papers ran through production the way a reader adds a paper. The three older ones were scored from their stored records. 2611.29224 had been analyzed before check questions existed, and its Check score of 1 is for their absence.

| Paper | Cov | Acc | Grd | Lvl | Br | Seq | Ovw | Chk | Lnk | Math | Mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1706.03762 | 4 | 3 | 4 | 4 | 4 | 3 | 3 | 2 | 2 | 3 | 3.2 |
| 2611.29224 | 3 | 3 | 3 | 4 | 4 | 4 | 4 | 1 | 3 | 5 | 3.4 |
| 2611.29002 | 4 | 3 | 3 | 4 | 4 | 4 | 3 | 2 | 2 | 2 | 3.1 |
| 2611.31236 | 3 | 4 | 4 | 2 | 4 | 3 | 2 | 2 | 4 | 3 | 3.1 |
| 2611.31122 | 2 | 4 | 2 | 3 | 2 | 3 | 2 | 2 | 2 | 4 | 2.6 |
| 2611.30998 | 3 | 4 | 3 | 2 | 4 | 4 | 3 | 2 | 5 | 3 | 3.3 |
| 2611.30552 | 4 | 4 | 5 | 4 | 4 | 3 | 5 | 1 | 4 | n/a | 3.8 |
| 2611.29886 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 3 | 4 | n/a | 3.9 |

No paper passed, so the pipeline failed. The report ranked its findings by impact:

1. Check questions did not work as a test. 4 of 88 had a wrong key, and the key was the longest choice in 73 of 88. The weakest single output was a 2611.30998 question keyed to "radius 2/a" where the paper says √(2/a), and its explanation argued for the correct choice.
2. Concepts reused broader starter topics. "Positional encoding" mapped to word embeddings, and "BLEU score" and "Local R^2 score" both mapped to "Evaluation metrics (accuracy, precision, recall)". Because knowledge was stored per topic, a reader who knew BLEU would have seen local R² as known.
3. Formulas damaged by PDF extraction were shown as clean LaTeX: "divide each by \(d_k\)" where the paper has √dk, a lost ½, and χ²_k shown as χ_k.
4. 31 of 118 quotes (26%) broke the prompt's own quote rule, as equations, lead-ins, fragments under 8 words or duplicates, while the app reported every quote verified.
5. Math papers outside machine learning had thin foundations, and concept counts did not grow with length: 12 concepts for 26 pages, 15 for 51 and 18 for the Transformer's 15.
6. Overview stories leaked jargon and made factual errors, such as "the softmax keeps gradients from vanishing" for 1706.03762, where the scaling does that.
7. Smaller defects included single-concept branches, an inverted dependency in 1706.03762, and raw search results stored as links when the link picker found no fit.

Two findings, the √dk quote and the 2/a radius, were confirmed in production records before any fix. Both came from pdftotext dropping the √. The run cost 36.52 credits (100 credits are one US dollar): 20.49 to analyze five papers and 16.03 for one branch of links each.

## Pipeline version 2

These changes are in commits 04a652b to 0d66efc:

- Text comes from the arXiv HTML page, with each formula taken from its LaTeX `alttext`. CloudConvert converts the PDF only when there is no HTML or it yields under 4,000 characters.
- The concept call returns up to two candidate quotes per concept. The server keeps the first one that is found in the paper, has at least 8 words, contains no `=` or display math, doesn't end in a lead-in and isn't another concept's quote.
- A concept may reuse an existing topic only when the two names share a content word.
- A branch with one concept merges into a neighbouring branch.
- The prompt asks for 10 to 18 concepts, or up to 24 above 40,000 characters, starting with the foundations a newcomer to the field needs.
- A verify stage (`src/server/pipeline/verify.ts`) has one Haiku call judge each overview sentence and technical line against the abstract, the introduction and the quotes, and unsupported ones are dropped.
- When the link picker finds nothing that fits, the topic keeps an empty list. A specialized topic that only one paper uses gets no search.
- The app owner can re-analyze a paper. Topics are kept, and readers' checkmarks move to the new concepts by name.

Check questions were removed from the app rather than repaired, so the second evaluation skips that criterion.

The first production re-analysis kept 4 of 9 overview sentences for 1706.03762. Its logs showed that every drop was a jargon flag on words such as "GPUs" and "projections", and none was a factual flag. Since 0d66efc, jargon flags are logged and passed to a rewrite but never drop a sentence. All eight papers were then re-analyzed one at a time, each from HTML with no retries.

## Second evaluation

These scores belong to pipeline version 2 at commit 0d66efc, scored on 2026-11-24 within an hour of re-analyzing all eight papers. Means are over nine criteria, or eight where Math is n/a. The last column is the first evaluation's mean recomputed without check questions.

| Paper | Cov | Acc | Grd | Lvl | Br | Seq | Ovw | Lnk | Math | Mean | Result | First mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1706.03762 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 5 | 5 | 4.44 | pass | 3.33 |
| 2611.29224 | 4 | 5 | 2 | 4 | 4 | 4 | 4 | 4 | 5 | 4.00 | fail | 3.67 |
| 2611.29002 | 4 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | 5 | 4.22 | pass | 3.22 |
| 2611.31236 | 4 | 5 | 3 | 4 | 4 | 4 | 4 | 3 | 5 | 4.00 | pass | 3.22 |
| 2611.31122 | 4 | 4 | 2 | 3 | 3 | 3 | 3 | 2 | 5 | 3.22 | fail | 2.67 |
| 2611.30998 | 4 | 5 | 4 | 3 | 5 | 5 | 5 | 5 | 5 | 4.56 | pass | 3.44 |
| 2611.30552 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | 4 | n/a | 4.38 | pass | 4.13 |
| 2611.29886 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | n/a | 4.00 | pass | 4.00 |

Six of eight passed, against two of eight before once check questions are left out. Math, Links and Accuracy rose the most. The attention formula now has its \(\sqrt{d_k}\), the ½ and χ² damage is gone, and positional encoding, BLEU and orthonormal embeddings have their own topics.

Both failures came down to grounding:

- 2611.29224 scored Grounding 2 because 9 of its 16 concepts had no quote. The new rules removed its 7 rule-breaking quotes, such as "w = wT + wN (tangent, normal)", and found nothing in their place.
- 2611.31122 scored Grounding 2 and Links 2, with a mean of 3.22. Its two central concepts had no quote, and three of its ten quotes stopped before their point ("Minimizing over both the price and the mixture gives (9"). "Linear programming and duality" sat in a later branch than a concept that depends on it. That made the branch order circular, and `recommendedSequence()` fell back to the model's order. The off-topic links the first evaluation found on this paper, a number-guessing puzzle blog and a MathOverflow thread, were still stored, because a topic keeps its links across re-analysis.

Across all eight papers, 26 of 135 concepts showed no quote. Another 13 shown quotes passed the rules but stopped inside a bracket or just before the clause they introduce. The fix plan had set targets of zero rule-breaking quotes and zero over-broad topic reuses, and both were met. Its target of a mean of at least 4 with nothing below 3 on every paper was not. Loading one branch of links per paper cost 18.89 credits for 20 Exa searches, and 11 topics used by one paper only were skipped at no cost.

## Grounding fixes

These changes address the second evaluation's grounding failures (commits 4d66b78 to 6073a70):

- A quote that stops at a bracket, an equation reference or before its main clause is carried to the end of its sentence, or rejected if the longer quote fails the rules.
- When every candidate fails, the server searches the stored text for a sentence that names the concept and runs it through the same rules (`findNamedQuote`).
- A concept whose placement makes the branch order circular moves to the branch that uses it.
- Raw search results kept as fallback links need two content words in common with the topic name, and a cleanup script resets topics holding older ones.

They were measured offline on the eight papers' stored concepts and text, with no model calls, and have not been scored with the rubric. Concepts without a quote fell from 26 to 19, both branch cycles (2611.31122 and 2611.29886) were gone, and 12 clipped quotes were extended to the end of their sentence. 2611.31122 went from 6 to 7 unquoted concepts, because two broken quotes were now rejected and only one replacement was found. Most of the remaining gaps are concepts named in words the paper never uses. The link cleanup reset 1 of 76 topics, the one holding the number-guessing links.

## Content rules (2026-11-25)

A content review by another fresh agent read the stored output of ten papers offline (the eight above plus 2507.17311 and 2610.08144) and reported 10 findings. The six rules below followed it (commits 7c6b051 to ba8959b), and each was replayed offline on the same ten papers' stored data.

| Rule | Applied in | Offline effect on 10 papers |
| --- | --- | --- |
| A quote that starts mid-sentence is carried back to the sentence start | Analysis job | 18 quotes now begin at their sentence start. Quoted concepts went from 147 to 146 of 167 |
| The fallback sentence search treats curly and straight apostrophes alike, and rejects lines without sentence-ending punctuation (titles, keyword lists) and more openers that refer to the previous sentence | Analysis job | With the fallback forced on every concept, 13 picks changed, and sentences found went from 89 to 87 of 167 |
| A foundation with no prerequisites is capped at working depth | Analysis job | 5 concepts moved from deep to working |
| "Where it fits" is hidden when it restates the why-needed line | Concept card | 93 of 166 plain roles hidden |
| A cut step label drops a trailing function word | Step strip | 16 of 42 cut labels changed, such as "Linear algebra and…" to "Linear algebra…" |
| The walkthrough has one entry per top-level section through the conclusion, and its cap rose from 14 to 20 entries | Analysis job | Tested with model calls, below |

The walkthrough prompt was tested with direct Haiku calls on 1706.03762, 2611.29886 and 2611.30998, for 1.44 credits. Each walkthrough ran through the paper's conclusion with headings copied from the paper, with no formula outside LaTeX and no KaTeX error. The stored walkthroughs of the last two papers had stopped at 14 entries before their conclusion, and 1706.03762's had 9 formulas in plain text.

A rule that sets the concept count by walking the paper's sections was tested on three papers for 4.35 credits and not adopted. It raised the counts from 16 to 18, 18 to 21 and 18 to 28.

The four rules in the analysis job reach a stored paper only when it is re-analyzed. The card and step-strip rules apply to every paper when it is shown. The second evaluation's scores were measured before these rules and before the grounding fixes, and the rubric has not been run again since.

## Open weaknesses

These come from the second evaluation and the later replays:

- Concepts named in words the paper never uses still have no quote. The fallback can also pick a paragraph heading that ends in a period, such as "A recap of the sum-check protocol for TQBF." for 2611.31236.
- Some field foundations are missing. 2611.30998 has no covariance matrix, and 2611.29002 never introduces "logit".
- Story text still uses unexplained terms ("logits", "orbit", PSPACE). Jargon flags reach a rewrite only when one runs for another reason.
- When verification drops a story item whose concepts appear in no other item, those concepts are listed as also needed. In 2611.31122 this removed the item for the paper's Theorem 1.
- Links are weaker outside well-known topics. The second evaluation found research articles stored as beginner explainers, one link that returns 404, and template searches such as "Pairwise parity tilt explained for beginners" that find nothing. Picked links are not checked for dead URLs.
- Topic descriptions sometimes copy one paper's why-needed line, which then shows on other papers.
- The 90,000-character text cap cut 2611.30998 partway through its Discussion, so its analysis never saw the conclusion.
- Long papers do not get more concepts. The five papers over 40,000 characters got 16 to 19, below the 24 the prompt allows.
