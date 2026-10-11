import { ICONS } from './icons.generated'

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const body = ICONS[name]
  if (!body) return null
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  )
}
