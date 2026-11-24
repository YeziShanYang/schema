/**
 * Paper window outside a workspace (readable signed out, in demo mode).
 */

import { useParams } from 'react-router-dom'
import { PaperWindow } from '../../../components/paper/PaperWindow'
import { arxivFromSlug } from '../../../lib/arxiv'

export default function PaperPage() {
  const { arxivId: slug = '' } = useParams()
  return <PaperWindow arxivId={arxivFromSlug(slug)} />
}
