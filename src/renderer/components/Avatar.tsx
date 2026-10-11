import { agentColor, initials } from '../lib/agentColor'

export function Avatar({ name, profile, size = 20 }: { name: string; profile: string; size?: number }) {
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
