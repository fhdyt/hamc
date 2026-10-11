import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

interface Props {
  /** One array per series, all the same length (the x axis is generated). */
  series: number[][]
  colors: string[]
  height: number
  max?: number
  label: string
}

const xs = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

export function UplotChart({ series, colors, height, max, label }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const colorRef = useRef(colors)
  colorRef.current = colors
  const seriesRef = useRef(series)
  seriesRef.current = series

  useEffect(() => {
    const el = host.current!
    const initial = seriesRef.current
    const n = initial[0]?.length ?? 60
    const u = new uPlot(
      {
        width: Math.max(120, el.clientWidth),
        height,
        legend: { show: false },
        cursor: { show: false },
        padding: [2, 0, 0, 0],
        scales: { x: { time: false }, y: { range: (_u, _min, dataMax) => [0, max ?? Math.max(1, dataMax * 1.15)] } },
        axes: [{ show: false }, { show: false }],
        series: [
          {},
          ...initial.map((_, i) => ({
            stroke: () => colorRef.current[i] ?? '#50FA7B',
            fill: () => `${colorRef.current[i] ?? '#50FA7B'}33`,
            width: 1.5,
            points: { show: false }
          }))
        ]
      },
      [xs(n), ...initial] as uPlot.AlignedData,
      el
    )
    plot.current = u
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(120, el.clientWidth), height }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
      plot.current = null
    }
  }, [height, max, series.length])

  useEffect(() => {
    if (document.visibilityState === 'hidden') return
    const n = series[0]?.length ?? 60
    plot.current?.setData([xs(n), ...series] as uPlot.AlignedData)
  }, [series, colors])

  return <div ref={host} role="img" aria-label={label} style={{ width: '100%', height }} />
}
