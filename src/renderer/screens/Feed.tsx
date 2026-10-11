import { FeedView } from './feed/FeedView'

export function Feed() {
  return (
    <div className="page">
      <h1 className="page-title">Live feed</h1>
      <FeedView />
    </div>
  )
}
