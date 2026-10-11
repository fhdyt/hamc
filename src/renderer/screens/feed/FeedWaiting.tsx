import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { useStalled } from '../../hooks/useStalled'
import { useConn } from '../../stores/conn'
import { useFeed } from '../../stores/feed'

/** What the feed shows before its first data: a spinner for a few seconds, then the reason it is taking long. */
export function FeedWaiting({ rows = 4 }: { rows?: number }) {
  const error = useFeed((s) => s.error)
  const connState = useConn((s) => s.status.state)
  const waiting = connState === 'connected' || connState === 'connecting'
  const stalled = useStalled(waiting && !error)
  if (error) return <ErrorState title="The feed cannot be read" why={error} />
  if (!waiting) return <EmptyState title="No activity yet" why="Items appear once Mission Control is connected." />
  if (stalled) return <EmptyState title="Still waiting for the server" why="The server has not sent any feed data yet. The collector errors, if any, are in the app log." />
  return <Skeleton rows={rows} />
}
