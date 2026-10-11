import { Modal } from '../../components/Modal'
import { useBrain } from '../../stores/brain'
import { NoteLinks, NoteText, useNoteLinks } from './NoteBody'

/** Reads one note in a dialog; opened by a click on a node of the Dashboard graph (F-R12). */
export function NoteModal() {
  const id = useBrain((s) => s.noteModal)
  const note = useBrain((s) => (s.noteModal ? s.notes.get(s.noteModal) : undefined))
  const open = useBrain((s) => s.openNote)
  if (!id || !note) return null
  return <Body key={id} id={id} title={note.title} path={note.id} onOpen={open} onClose={() => open(null)} />
}

function Body({ id, title, path, onOpen, onClose }: { id: string; title: string; path: string; onOpen(id: string): void; onClose(): void }) {
  const { outgoing, backlinks } = useNoteLinks(id)
  return (
    <Modal title={title} onClose={onClose} width={720}>
      <p className="bn-path">{path}</p>
      <NoteText id={id} onOpen={onOpen} />
      <NoteLinks title="Backlinks" notes={backlinks} onOpen={onOpen} />
      <NoteLinks title="Outgoing links" notes={outgoing} onOpen={onOpen} />
    </Modal>
  )
}
