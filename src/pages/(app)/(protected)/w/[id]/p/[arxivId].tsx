/**
 * Paper window inside a workspace: same view as /p/[arxivId], with a back
 * link to the workspace and workspace actions.
 */

import { Navigate, useParams } from 'react-router-dom'
import { PaperWindow } from '../../../../../../components/paper/PaperWindow'
import { arxivFromSlug, arxivSlug, parseArxivId } from '../../../../../../lib/arxiv'

export default function WorkspacePaperPage() {
  const { id = '', arxivId: slug = '' } = useParams()
  const ref = parseArxivId(arxivFromSlug(slug))
  // A versioned or otherwise non-canonical id opens the paper under its canonical slug.
  if (ref && arxivSlug(ref.id) !== slug) return <Navigate replace to={`/w/${id}/p/${arxivSlug(ref.id)}`} />
  return <PaperWindow arxivId={ref?.id ?? arxivFromSlug(slug)} workspaceId={id} />
}
