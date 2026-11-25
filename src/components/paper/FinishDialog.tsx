/**
 * "Mark this paper finished?" with the choice to also check the paper's
 * remaining concepts. The paper window and the library both use it, so a
 * paper is finished the same way from either (useFinishPaper): the roadmap,
 * its workspace entries and, if chosen, the rest of its concepts.
 */

import { useState } from 'react'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import { Button, Checkbox, Label, Modal } from '@/components/ui'
import { useFinishPaper } from '../../hooks/usePaper'
import type { ConceptData, PaperData } from '../../types'

export function FinishDialog({ paper, open, onClose }: { paper: RecordData<PaperData> | null; open: boolean; onClose: () => void }) {
  const finishPaper = useFinishPaper()
  const concepts = useQuery<ConceptData>('concepts', { where: { paperId: open && paper ? paper.recordId : '__none__' }, limit: 200 })
  const [markRest, setMarkRest] = useState(true)
  const [finishing, setFinishing] = useState(false)

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header>
        <Modal.Title>Mark this paper finished?</Modal.Title>
        <Modal.Description>It moves to Finished in your library and in its workspaces. You can read it again later.</Modal.Description>
      </Modal.Header>
      <div className="flex items-center gap-2" data-testid="finish-panel">
        <Checkbox id="mark-rest" checked={markRest} onCheckedChange={setMarkRest} />
        <Label htmlFor="mark-rest">Also check the remaining concepts in this paper</Label>
      </div>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          loading={finishing}
          // Checking the rest needs the paper's concepts, which load when the dialog opens.
          disabled={!paper || (markRest && concepts.status !== 'ready')}
          data-testid="finish-confirm"
          onClick={async () => {
            if (!paper) return
            setFinishing(true)
            await finishPaper({ paper, concepts: concepts.records, markRemainingKnown: markRest })
            setFinishing(false)
            onClose()
          }}
        >
          Mark finished
        </Button>
      </Modal.Footer>
    </Modal>
  )
}
