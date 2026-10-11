const PALETTE = ['#50FA7B', '#8BE9FD', '#BD93F9', '#FF79C6', '#FFB86C', '#F1FA8C']

export function agentColor(profile: string): string {
  let h = 0
  for (let i = 0; i < profile.length; i++) h = (h * 31 + profile.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

export function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}
