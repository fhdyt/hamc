export function pushWindow(arr: readonly number[], v: number, n = 60): number[] {
  const next = arr.length >= n ? arr.slice(arr.length - n + 1) : arr.slice()
  next.push(v)
  return next
}

export function padLeft(arr: readonly number[], n = 60): number[] {
  if (arr.length >= n) return arr.slice(arr.length - n)
  return [...new Array<number>(n - arr.length).fill(0), ...arr]
}
