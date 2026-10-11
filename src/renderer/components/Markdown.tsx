import { useEffect, useMemo, useRef, type MouseEvent } from 'react'
import { renderMarkdown } from '../lib/brain/markdown'

/** A reply as markdown: tables, lists, emphasis and code blocks with a Copy button. The text is untrusted and sanitized. */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelectorAll('pre.md-pre').forEach((pre) => {
      if (pre.querySelector('.md-copy')) return
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'md-copy'
      b.textContent = 'Copy'
      b.setAttribute('aria-label', 'Copy code')
      pre.appendChild(b)
    })
  }, [html])

  const click = (e: MouseEvent<HTMLDivElement>): void => {
    const b = (e.target as HTMLElement).closest('.md-copy')
    if (!b) return
    const code = b.closest('pre')?.querySelector('code')?.textContent ?? ''
    void navigator.clipboard.writeText(code).then(() => {
      b.textContent = 'Copied'
      window.setTimeout(() => {
        b.textContent = 'Copy'
      }, 1200)
    })
  }

  return <div ref={ref} className={`md-chat ${className}`} onClick={click} dangerouslySetInnerHTML={{ __html: html }} />
}
