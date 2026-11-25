/**
 * "Mark this paper finished?" with the choice to also check the paper's
 * remaining concepts, and its reverse, "Read this paper again?" with the
 * choice to uncheck the concepts finishing checked (rows with source
 * `finished`), unticked by default. The paper window and the library both
 * use it, so a paper is finished and reopened the same way from either
 * (useFinishPaper, useReopenPaper): the roadmap, its workspace entries and,
 * if chosen, the paper's concepts. Read again asks only when finishing
 * checked something (ReadAgainButton); otherwise it reopens at once.
 */

import { useEffect, useState } from 'react'
import { useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import { Button, Checkbox, Label, Modal, type ButtonProps } from '@/components/ui'
import { plural } from '@/lib/utils'
import { useFinishPaper, useReopenPaper } from '../../hooks/usePaper'
import { useConceptKnowledge } from '../../hooks/useReader'
import type { ConceptData, ConceptKnowledgeData, PaperData } from '../../types'

/** The paper's checkmarks that "Mark finished" made. */
function checkedAtFinish(rows: RecordData<ConceptKnowledgeData>[], paperId: string) {
  return rows.filter((r) => r.data.paperId === paperId && r.data.source === 'finished' && r.data.status === 'known')
}

export function FinishDialog({
  paper,
  paperId: idProp,
  open,
  onClose,
  mode = 'finish',
}: {
  paper?: RecordData<PaperData> | null
  /** Enough for Read again, which the library offers before the paper record has loaded. */
  paperId?: string
  open: boolean
  onClose: () => void
  mode?: 'finish' | 'read-again'
}) {
  const finishPaper = useFinishPaper()
  const reopenPaper = useReopenPaper()
  const knowledge = useConceptKnowledge()
  const paperId = paper?.recordId ?? idProp ?? ''
  const finishing = mode === 'finish'
  const concepts = useQuery<ConceptData>('concepts', { where: { paperId: open && finishing && paperId ? paperId : '__none__' }, limit: 200 })
  const fromFinish = finishing ? [] : checkedAtFinish(knowledge.rows, paperId)
  // Finishing offers to check the rest (ticked); reading again offers to undo that (unticked).
  const [choice, setChoice] = useState(finishing)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setChoice(finishing)
  }, [open, finishing])

  async function confirm() {
    setBusy(true)
    if (finishing) {
      if (paper) await finishPaper({ paper, concepts: concepts.records, markRemainingKnown: choice })
    } else {
      if (choice) for (const r of fromFinish) await knowledge.clear(r.data.conceptId)
      await reopenPaper(paperId)
    }
    setBusy(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header>
        <Modal.Title>{finishing ? 'Mark this paper finished?' : 'Read this paper again?'}</Modal.Title>
        <Modal.Description>
          {finishing
            ? 'It moves to Finished in your library and in its workspaces. You can read it again later.'
            : 'It moves back to In progress in your library and in its workspaces.'}
        </Modal.Description>
      </Modal.Header>
      <div className="flex items-center gap-2" data-testid={finishing ? 'finish-panel' : 'read-again-panel'}>
        <Checkbox id={`${mode}-choice`} checked={choice} onCheckedChange={setChoice} />
        <Label htmlFor={`${mode}-choice`}>
          {finishing
            ? 'Also check the remaining concepts in this paper'
            : `Also uncheck the ${plural(fromFinish.length, 'concept', 'concepts')} checked when you finished`}
        </Label>
      </div>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          loading={busy}
          // Checking the rest needs the paper's concepts, which load when the dialog opens.
          disabled={finishing ? !paper || (choice && concepts.status !== 'ready') : !paperId || (choice && !knowledge.ready)}
          data-testid={finishing ? 'finish-confirm' : 'read-again-confirm'}
          onClick={() => void confirm()}
        >
          {finishing ? 'Mark finished' : 'Read again'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

/** Read again: at once, or through the dialog above when finishing checked some of the paper's concepts. */
export function ReadAgainButton({ paperId, testId, ...props }: Omit<ButtonProps, 'onClick' | 'children'> & { paperId: string; testId: string }) {
  const knowledge = useConceptKnowledge()
  const reopenPaper = useReopenPaper()
  const [open, setOpen] = useState(false)
  const asks = checkedAtFinish(knowledge.rows, paperId).length > 0
  return (
    <>
      <Button {...props} onClick={() => (asks ? setOpen(true) : void reopenPaper(paperId))} data-testid={testId}>
        Read again
      </Button>
      <FinishDialog mode="read-again" paperId={paperId} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
