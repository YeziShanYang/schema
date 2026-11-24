/**
 * Paper window inside a workspace: same view as /p/[arxivId], with a back
 * link to the workspace and workspace actions.
 */

import { useParams } from 'react-router-dom'
import { PaperWindow } from '../../../../../../components/paper/PaperWindow'
import { arxivFromSlug } from '../../../../../../lib/arxiv'

export default function WorkspacePaperPage() {
  const { id = '', arxivId: slug = '' } = useParams()
  return <PaperWindow arxivId={arxivFromSlug(slug)} workspaceId={id} />
}
