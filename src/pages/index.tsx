/**
 * Landing page — static (no providers, no data hooks), prerendered at build.
 * The example section reads the bundled snapshot of a real pipeline run
 * (src/data/demo-snapshot.json). The interactive branch graph is designed
 * separately; until then the example shows the same branches as a list.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { MarkIcon } from '../components/icons'
import { APP_DISPLAY_NAME, DEMO_ARXIV_ID } from '../constants'
import { demoSnapshot } from '../data/demo'
import { DAILY_PAPER_CAP } from '../lib/cap'
import { arxivSlug } from '../lib/arxiv'
import { seo } from '../seo'

const STEPS = [
  ['Pick a paper', 'Paste an arXiv link, or create a workspace for a subject and get three recommended papers.'],
  ['See its branches', 'The paper is read once and its concepts are grouped into three to six branches, ordered so prerequisites come first.'],
  ['Mark what you know', 'Each concept is tied to the passage where the paper uses it. What you mark is saved to your knowledge profile and carries over to the next paper.'],
  ['Learn the rest', 'Open a branch to load explainer links found on the web, ask for an AI explanation with a worked example, or answer a check question.'],
  ['Finish', 'Mark the paper finished, optionally marking its remaining topics known, and move to the next one.'],
] as const

export default function Landing() {
  const snap = demoSnapshot
  const [open, setOpen] = useState(snap.branches[0]?.key ?? '')
  const branch = snap.branches.find((b) => b.key === open) ?? snap.branches[0]
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
            <Link to="/home" className="press rounded px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent">
              Sign in
            </Link>
          </div>
        </header>

        <main>
          <section className="dot-grid border-b border-border">
            <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
              <p className="label enter" style={{ ['--i' as string]: 0 }}>Learning roadmaps for arXiv papers</p>
              <h1 className="enter mt-3 max-w-3xl text-[34px] font-semibold leading-[1.1] tracking-[-0.01em] text-balance md:text-[44px]" style={{ ['--i' as string]: 1 }}>
                See every idea a research paper relies on, and learn the ones you are missing.
              </h1>
              <p className="enter mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground text-pretty" style={{ ['--i' as string]: 2 }}>
                Schema reads an arXiv paper once and lists the concepts it builds on, from foundations to the paper's own ideas, grouped into branches and ordered by prerequisite. You mark what you already know, and the rest comes with the passage that uses it, explainer links and an optional AI explanation. Your knowledge carries over from paper to paper.
              </p>
              <div className="enter mt-7 flex flex-wrap gap-2" style={{ ['--i' as string]: 3 }}>
                <Link to={demoHref} className="press inline-flex h-10 items-center rounded bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-[color-mix(in_oklab,var(--color-primary)_88%,black)]" data-testid="landing-demo">
                  Open the full demo
                </Link>
                <Link to="/home" className="press inline-flex h-10 items-center rounded border border-border bg-card px-5 text-sm font-medium hover:bg-surface-2">
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

            <div className="mt-5 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <ul className="grid gap-2 self-start" data-testid="landing-branches">
                {snap.branches.map((b) => (
                  <li key={b.key}>
                    <button
                      type="button"
                      aria-pressed={b.key === branch?.key}
                      onClick={() => setOpen(b.key)}
                      data-testid="landing-branch"
                      className={
                        'press w-full cursor-pointer rounded border border-transparent bg-card p-3 text-left ' +
                        (b.key === branch?.key ? 'shadow-[0_0_0_2px_var(--color-primary),var(--shadow-ring-hi)]' : 'shadow-[var(--shadow-ring)] hover:shadow-[var(--shadow-ring-hi)]')
                      }
                    >
                      <span className="block text-sm font-semibold">{b.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{b.concepts.length} concepts</span>
                    </button>
                  </li>
                ))}
              </ul>

              {branch && (
                <div className="surface min-w-0" data-testid="landing-branch-concepts">
                  <div className="border-b border-border px-4 pb-3 pt-4">
                    <h3 className="text-lg font-semibold">{branch.name}</h3>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{branch.description}</p>
                  </div>
                  <ul className="divide-y divide-border px-4">
                    {branch.concepts.map((c) => {
                      const topic = snap.topics[c.topicKey]
                      return (
                        <li key={c.key} className="py-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold">{c.name}</span>
                            <span className={'rounded-[3px] border px-[7px] py-px font-mono text-[11px] uppercase tracking-[0.05em] ' + (c.depth === 'deep' ? 'border-transparent bg-accent-soft text-primary' : 'border-border bg-surface-2 text-muted-foreground')}>
                              {c.depth}
                            </span>
                          </div>
                          <p className="mt-1 text-[13px] text-muted-foreground">{c.whyNeeded}</p>
                          {c.quote && (
                            <blockquote className="mt-2 rounded-r border-l-2 border-border bg-surface-2 px-2.5 py-2 text-[12.5px] text-muted-foreground">
                              “{c.quote}” <cite className="label mt-1 block not-italic text-faint">{c.section}</cite>
                            </blockquote>
                          )}
                          {topic?.resource && (
                            <a href={topic.resource.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12.5px] text-primary hover:underline">
                              {topic.resource.title}
                            </a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
            <p className="mt-3 text-[13px] text-muted-foreground">
              <Link to={demoHref} className="text-primary hover:underline">Open this paper</Link> to try marking concepts, the check questions and the AI explanations. No sign-in needed.
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
