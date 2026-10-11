import { Modal } from '../../components/Modal'
import { useFeed } from '../../stores/feed'
import { FeedView } from './FeedView'

/** The Live feed in a dialog, opened from the Dashboard activity panel (F-R12-4). */
export function FeedModal() {
  const open = useFeed((s) => s.modalOpen)
  const close = useFeed((s) => s.closeModal)
  if (!open) return null
  return (
    <Modal title="Live feed" onClose={close} width={1040}>
      <div className="fmodal-body">
        <FeedView />
      </div>
    </Modal>
  )
}
