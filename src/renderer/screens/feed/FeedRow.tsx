import { loadFullText } from '../../actions'
import { Icon } from '../../components/Icon'
import { agentColor } from '../../lib/agentColor'
import { KIND_COLOR, KIND_LABEL, canExpand, clockWithDay, sourceOf, toolPreview } from '../../lib/feed'
import { useFeed } from '../../stores/feed'
import type { FeedItem } from '@shared/events'

interface Props {
  item: FeedItem
  name: string
  /** Open the whole session this item belongs to. Left out inside the session view itself. */
  onOpenSession?: (item: FeedItem) => void
}

export function FeedRow({ item, name, onOpenSession }: Props) {
  const expanded = useFeed((s) => s.expanded[item.id] === true)
  const full = useFeed((s) => s.full[item.id])
  const toggle = useFeed((s) => s.toggleExpanded)
  const color = KIND_COLOR[item.kind]
  const expandable = canExpand(item)
  const text = expanded && full?.status === 'ok' ? full.text : item.text
  const shown = item.kind === 'tool' ? toolPreview(text) : text
  const clamp = expandable && !expanded

  const onToggle = (): void => {
    toggle(item.id)
    if (!expanded && item.truncated) void loadFullText(item)
  }

  const label = item.toolName && (item.kind === 'result' || item.kind === 'tool') ? `${KIND_LABEL[item.kind]} · ${item.toolName}` : KIND_LABEL[item.kind]

  return (
    <div className="fr" data-kind={item.kind} data-profile={item.profile}>
      <span className="fr-t num">{clockWithDay(item.ts)}</span>
      <span className="fr-a" style={{ color: agentColor(item.profile) }} title={item.profile}>
        {name}
      </span>
      <span className="fr-s" title={item.sessionId}>
        {sourceOf(item)}
      </span>
      <div className="fr-c">
        <span className="fr-l" style={{ color }}>
          {label}
        </span>
        {item.kind === 'thinking' ? (
          <p className={`fr-think ${clamp ? 'clamp2' : ''}`}>{shown}</p>
        ) : item.kind === 'tool' || item.kind === 'result' ? (
          <code className={`fr-code ${item.kind} ${clamp ? 'clamp4' : ''}`}>{shown}</code>
        ) : (
          <p className={`fr-text ${clamp ? 'clamp4' : ''}`}>{shown}</p>
        )}
        {expandable && (
          <button type="button" className="fr-more" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? 'Show less' : item.truncated ? 'Show full' : item.kind === 'thinking' ? 'Expand thinking' : 'Show more'}
          </button>
        )}
        {expanded && full?.status === 'loading' && <span className="fr-note">Loading the full text…</span>}
        {expanded && full?.status === 'error' && (
          <span className="fr-note bad">
            {full.message}{' '}
            <button type="button" className="fr-more" onClick={() => void loadFullText(item)}>
              Retry
            </button>
          </span>
        )}
      </div>
      {onOpenSession && (
        <button type="button" className="ib sm fr-open" onClick={() => onOpenSession(item)} aria-label={`Open the ${sourceOf(item)} session`} title="Open the whole session">
          <Icon name="history" size={13} />
        </button>
      )}
    </div>
  )
}
