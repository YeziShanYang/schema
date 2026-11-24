/**
 * Paper window outside a workspace (readable signed out, in demo mode).
 */

import { Navigate, useParams } from 'react-router-dom'
import { PaperWindow } from '../../../components/paper/PaperWindow'
import { arxivFromSlug, arxivSlug, parseArxivId } from '../../../lib/arxiv'

export default function PaperPage() {
  const { arxivId: slug = '' } = useParams()
  const ref = parseArxivId(arxivFromSlug(slug))
  // A versioned or otherwise non-canonical id opens the paper under its canonical slug.
  if (ref && arxivSlug(ref.id) !== slug) return <Navigate replace to={`/p/${arxivSlug(ref.id)}`} />
  return <PaperWindow arxivId={ref?.id ?? arxivFromSlug(slug)} />
}
