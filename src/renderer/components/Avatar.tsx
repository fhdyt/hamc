import { agentColor, initials } from '../lib/agentColor'
import { useLooks } from '../stores/looks'

/** The agent's local photo (Settings → Agents → Profile) or its initials on its colour. */
export function Avatar({ name, profile, size = 20 }: { name: string; profile: string; size?: number }) {
  const photo = useLooks((s) => s.looks[profile]?.photo ?? null)
  if (photo) return <img className="avatar" src={photo} alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover', background: agentColor(profile) }} />
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)), background: agentColor(profile) }}
    >
      {initials(name)}
    </span>
  )
}
