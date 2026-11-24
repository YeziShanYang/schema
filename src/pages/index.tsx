/**
 * Landing page — static (no providers, no data hooks), prerendered at build.
 * The example section reads the bundled snapshot of a real pipeline run
 * (src/data/demo-snapshot.json). The interactive branch graph is designed
 * separately; until then the example shows the same branches as a list.
 */

import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { MarkIcon } from '../components/icons'
import { FloatingGraph } from '../components/graph/FloatingGraph'
import { BranchPanel } from '../components/graph/BranchPanel'
import { CenterCard } from '../components/graph/nodes'
import { recommendedSequence } from '../lib/sequence'
import { linkTitle } from '../lib/links'
import { cleanTitle } from '../components/Markdown'
import { APP_DISPLAY_NAME, DEMO_ARXIV_ID } from '../constants'
import { demoSnapshot } from '../data/demo'
import { DAILY_PAPER_CAP } from '../lib/cap'
import { arxivSlug } from '../lib/arxiv'
import { seo } from '../seo'
import { MathText } from '../components/MathText'

const STEPS = [
  ['Pick a paper', 'Paste an arXiv link, or create a workspace for a subject and get three recommended papers.'],
  ['See its branches', 'The paper is read once and its concepts are grouped into three to six branches, ordered so prerequisites come first.'],
  ['Mark what you know', 'Each concept is tied to the passage where the paper uses it. What you mark is saved to your knowledge profile and carries over to the next paper.'],
  ['Learn the rest', 'Open a branch to load explainer links found on the web, ask for an AI explanation with a worked example, or answer a check question.'],
  ['Finish', 'Mark the paper finished, optionally marking its remaining topics known, and move to the next one.'],
] as const

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const countWord = (n: number) => WORDS[n] ?? String(n)

export default function Landing() {
  const snap = demoSnapshot
  const [open, setOpen] = useState('')
  const branch = snap.branches.find((b) => b.key === open) ?? null
  const buttons = useRef(new Map<string, HTMLButtonElement | null>())
  const lastOpened = useRef('')
  const openBranch = (key: string) => {
    lastOpened.current = key
    setOpen(key)
  }
  // The app's sequence for a reader who knows nothing yet, from the same
  // inputs the app uses (tier, the model's order and dependsOn), so the
  // example and the demo paper agree.
  const seq = useMemo(
    () =>
      recommendedSequence(
        snap.branches,
        snap.branches.flatMap((b) => b.concepts.map((c, i) => ({ ...c, branchKey: b.key, order: c.order ?? i, dependsOn: c.dependsOn ?? [] }))),
        () => null,
      ),
    [snap],
  )
  const explained = snap.branches.reduce((n, b) => n + b.concepts.filter((c) => c.explanation).length, 0)
  const demoHref = `/p/${arxivSlug(DEMO_ARXIV_ID)}`
  const total = snap.branches.reduce((n, b) => n + b.concepts.length, 0)

  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
            <span className="flex items-center gap-2 text-[17px] font-semibold">
              <MarkIcon size={18} className="text-primary" /> {APP_DISPLAY_NAME}
            </span>
            <Link to="/home?signin=1" className="press rounded px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent" data-testid="landing-sign-in">
              Sign in
            </Link>
          </div>
        </header>

        <main>
          <section className="dot-grid border-b border-border">
            <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
              <p className="label enter" style={{ ['--i' as string]: 0 }}>Learning roadmaps for arXiv papers</p>
              <h1 className="enter mt-3 max-w-3xl text-[34px] font-semibold leading-[1.1] tracking-[-0.01em] text-balance md:text-[44px]" style={{ ['--i' as string]: 1 }}>
                See every idea a research paper relies on, and learn the ones you're missing.
              </h1>
              <p className="enter mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground text-pretty" style={{ ['--i' as string]: 2 }}>
                Schema reads an arXiv paper once and lists the concepts it builds on, from foundations to the paper's own ideas, grouped into branches and ordered by prerequisite. You mark what you already know, and the rest comes with the passage that uses it, explainer links and an optional AI explanation. Your knowledge carries over from paper to paper.
              </p>
              <div className="enter mt-7 flex flex-wrap gap-2" style={{ ['--i' as string]: 3 }}>
                <Link to={demoHref} className="press inline-flex h-10 items-center rounded bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-[color-mix(in_oklab,var(--color-primary)_88%,black)]" data-testid="landing-demo">
                  Open the full demo
                </Link>
                <Link to="/home?signin=1" className="press inline-flex h-10 items-center rounded border border-border bg-card px-5 text-sm font-medium hover:bg-surface-2" data-testid="landing-start">
                  Sign in to start a workspace
                </Link>
              </div>
            </div>
          </section>

          <section className="mx-auto max-w-6xl px-4 py-12 md:px-6" aria-labelledby="example-title" data-testid="landing-example">
            <p className="label">Example: real output for arXiv {snap.paper.arxivId}</p>
            <h2 id="example-title" className="mt-1 text-[22px] font-semibold">{snap.paper.title}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {snap.paper.authors.slice(0, 3).join(', ')} et al. · {snap.paper.year} · {total} concepts in {snap.branches.length} branches
            </p>

            <div className="surface mt-5 overflow-hidden">
              <FloatingGraph
                label={`Branches of ${snap.paper.title}`}
                testId="landing-graph"
                className="min-h-[520px]"
                center={
                  <CenterCard label="Target paper" className="w-[300px]">
                    <h3 className="mb-1 mt-1.5 text-[19px] font-semibold leading-tight">{snap.paper.title}</h3>
                    <p className="mb-2 text-[13px] text-muted-foreground">{snap.paper.authors[0]?.split(' ').slice(-1)[0]} et al. · {snap.paper.year} · <span className="font-mono">arXiv {snap.paper.arxivId}</span></p>
                    <p className="text-xs text-muted-foreground">{total} concepts in {snap.branches.length} branches. Click a branch.</p>
                  </CenterCard>
                }
                nodes={seq.steps.map((st) => {
                  const b = snap.branches.find((x) => x.key === st.branchKey)!
                  return {
                    key: b.key,
                    hot: open === b.key,
                    content: (
                      <button
                        type="button"
                        ref={(el) => {
                          buttons.current.set(b.key, el)
                        }}
                        onClick={() => openBranch(b.key)}
                        aria-haspopup="dialog"
                        data-testid="landing-branch"
                        data-branch-key={b.key}
                        className={
                          'press graph-w-branch block w-full cursor-pointer rounded border border-transparent bg-card px-3.5 py-3 text-left ' +
                          (st.index === 1 ? 'shadow-[0_0_0_2px_var(--color-primary),var(--shadow-ring-hi)]' : 'shadow-[var(--shadow-ring)] hover:shadow-[var(--shadow-ring-hi)]')
                        }
                      >
                        <span className="mb-1 flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-faint tabular-nums">Step {st.index}</span>
                          {st.index === 1 && <span className="label text-primary">Start here</span>}
                        </span>
                        <span className="block text-sm font-semibold leading-snug">{b.name}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{b.concepts.length} concepts</span>
                      </button>
                    ),
                  }
                })}
              />
            </div>
            <BranchPanel
              open={!!branch}
              onClose={() => setOpen('')}
              returnFocus={() => (lastOpened.current ? buttons.current.get(lastOpened.current) ?? null : null)}
              title={branch?.name ?? ''}
              eyebrow={branch ? `Example · ${branch.concepts.length} concepts` : ''}
              description={branch?.description}
              testId="landing-panel"
            >
              {branch && (
                <ul className="grid gap-3 min-[900px]:grid-cols-2" data-testid="landing-branch-concepts">
                  {seq.concepts
                    .filter((c) => c.branchKey === branch.key)
                    .map((c) => {
                      const topic = snap.topics[c.topicKey]
                      return (
                        <li key={c.key} className="rounded-lg border border-border bg-card p-3.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold">
                              <span className="mr-1.5 font-mono text-[11px] font-normal text-faint">{seq.stepInBranch.get(c.key)}.</span>
                              {c.name}
                            </span>
                            <span className={'rounded-[3px] border px-[7px] py-px font-mono text-[11px] uppercase tracking-[0.05em] ' + (c.depth === 'deep' ? 'border-transparent bg-accent-soft text-primary' : 'border-border bg-surface-2 text-muted-foreground')}>
                              {c.depth}
                            </span>
                          </div>
                          <p className="mt-1 text-[13px] text-muted-foreground">{c.whyNeeded}</p>
                          {c.quote && (
                            <blockquote className="mt-2 rounded-r border-l-2 border-border bg-surface-2 px-2.5 py-2 text-[12.5px] text-muted-foreground">
                              “{c.quoteDisplay ? <MathText text={c.quoteDisplay} /> : c.quote}” <cite className="label mt-1 block not-italic text-faint">{c.section}</cite>
                            </blockquote>
                          )}
                          {topic?.resource && (
                            <a href={topic.resource.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12.5px] text-primary hover:underline">
                              {cleanTitle(linkTitle(topic.resource.title, topic.resource.url))}
                            </a>
                          )}
                        </li>
                      )
                    })}
                </ul>
              )}
            </BranchPanel>
            <p className="mt-3 text-[13px] text-muted-foreground">
              <Link to={demoHref} className="text-primary hover:underline">Open this paper</Link> to try marking concepts, the recommended order and the check questions, no sign-in needed.{' '}
              {explained > 0 && (
                <>
                  {countWord(explained)} {explained === 1 ? 'concept has' : 'concepts have'} a saved AI explanation.{' '}
                  <Link to="/home?signin=1" className="text-primary hover:underline" data-testid="landing-explain-signin">Sign in</Link> to generate the rest.
                </>
              )}
            </p>
          </section>

          <section className="border-y border-border bg-card">
            <div className="mx-auto max-w-6xl px-4 py-12 md:px-6">
              <h2 className="label">How it works</h2>
              <ol className="mt-4 grid gap-4 md:grid-cols-5">
                {STEPS.map(([title, body], i) => (
                  <li key={title}>
                    <span className="font-mono text-[11px] text-faint">0{i + 1}</span>
                    <p className="mt-1 font-semibold">{title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="mx-auto max-w-6xl px-4 py-12 md:px-6">
            <h2 className="label">Limits</h2>
            <ul className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
              <li>arXiv papers only, and the analysis works best on papers written in English.</li>
              <li>A paper nobody has analyzed takes about one to two minutes. One already analyzed opens right away.</li>
              <li>Each account can start {DAILY_PAPER_CAP} new papers a day. A failed analysis does not count.</li>
              <li>Concepts and quotes come from a language model reading the extracted PDF text. Quotes are checked against the paper and hidden when they do not match.</li>
            </ul>
          </section>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-faint md:px-6">Built on DeepSpace.</div>
        </footer>
      </div>
    </>
  )
}
