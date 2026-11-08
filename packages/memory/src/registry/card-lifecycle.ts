import type { CardRecord, Conclusion, ResolutionStage } from '../cards/card-record.ts'
import { ClosingDraft } from '../notes/closing-draft.ts'

export class CardLifecycle {
  reconcile(record: CardRecord): CardRecord {
    const reopened = record.history.findLast((event) => event.action === 'reopened')
    const noteStart =
      record.lifecycle?.noteStart ??
      (reopened === undefined
        ? 0
        : record.history.slice(0, record.history.lastIndexOf(reopened)).filter((event) => event.action === 'noted').length)
    const notes = record.notes.map((note, index) => ({ ...note, id: note.id ?? `note-${String(index + 1)}` }))
    const current = notes.slice(noteStart)
    const conclusion: Conclusion | null =
      current.findLast((note) => note.conclusion !== null)?.conclusion ??
      (reopened === undefined && record.flag?.fields.did === 'fixed' ? 'fixed' : null)
    const stage: ResolutionStage =
      conclusion === null
        ? 'uninvestigated'
        : conclusion === 'fixed' || conclusion === 'refuted' || conclusion === 'needs-owner'
          ? conclusion
          : 'investigated'
    const revision = record.lifecycle?.revision ?? record.history.length
    const lifecycle = {
      revision,
      cycle: record.lifecycle?.cycle ?? record.history.filter((event) => event.action === 'reopened').length,
      noteStart,
      stage,
    }

    return { ...record, notes, lifecycle, proposal: new ClosingDraft(record, current).proposal(conclusion, revision) }
  }
}
