/**
 * Landing page — static (no providers), prerendered at build. Functional
 * placeholder until the visual design pass.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_DISPLAY_NAME } from '../constants'
import { seo } from '../seo'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <main data-testid="static-landing" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">{APP_DISPLAY_NAME}</p>
        <h1 className="text-4xl font-semibold tracking-tight">Learning roadmaps for arXiv papers</h1>
        <p className="text-muted-foreground">
          Pick a subject, get a recommended paper, and see every concept it relies on, grouped into branches and
          ordered by prerequisite. Each concept comes with the passage where the paper uses it, explainers found on the
          web, a check question and an on-demand AI explanation. What you learn is saved to your knowledge profile, so
          the next paper skips it.
        </p>
        <div>
          <Link
            to="/home"
            className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Open Schema
          </Link>
        </div>
      </main>
    </>
  )
}
