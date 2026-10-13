import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import { tidyMarkdown } from '../chatMarkdown'

export const NOTE_SCHEME = 'mc-note:'

function makeMd(breaks: boolean): MarkdownIt {
  const m = new MarkdownIt({ html: false, linkify: false, breaks })
  m.renderer.rules['image'] = (tokens, idx) => {
    const alt = m.utils.escapeHtml(tokens[idx]?.content ?? '')
    return `<span class="md-img">[image${alt ? ': ' + alt : ''}]</span>`
  }
  // Code blocks get a class and their language, so the chat can put a Copy button on them.
  m.renderer.rules['fence'] = (tokens, idx) => {
    const t = tokens[idx]
    const lang = (t?.info ?? '').trim().split(/\s+/)[0] ?? ''
    const safe = lang.replace(/[^A-Za-z0-9_+.-]/g, '').slice(0, 20)
    return `<pre class="md-pre"${safe ? ` data-lang="${safe}"` : ''}><code>${m.utils.escapeHtml(t?.content ?? '')}</code></pre>
`
  }
  return m
}

const md = makeMd(false)
/** Replies keep their single line breaks, as in any chat. */
const mdReply = makeMd(true)

/** Drops a leading `---` YAML block. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text)
  return m ? text.slice(m[0].length) : text
}

const link = (target: string, label: string): string => `[${label.replace(/[[\]]/g, '')}](${NOTE_SCHEME}${encodeURIComponent(target)})`

/** Turns `[[Note|alias]]` and `![[Note]]` into links the preview can follow, leaving code alone. */
export function prepare(text: string): string {
  return stripFrontmatter(text)
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(!?)\[\[([^[\]\n]+?)\]\]/g, (_m, bang: string, inner: string) => {
            const [rawTarget = '', alias] = inner.split('|')
            const target = rawTarget.split(/[#^]/)[0]!.trim()
            if (!target) return alias ?? rawTarget
            const label = (alias ?? rawTarget).trim()
            return bang ? link(target, `↪ ${label}`) : link(target, label)
          })
    )
    .join('')
}

let hooked = false
function hook(): void {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return
    const href = node.getAttribute('href') ?? ''
    if (href.startsWith(NOTE_SCHEME)) {
      let target = ''
      try {
        target = decodeURIComponent(href.slice(NOTE_SCHEME.length))
      } catch {
        target = href.slice(NOTE_SCHEME.length)
      }
      node.setAttribute('data-note', target)
      node.setAttribute('href', '#')
      node.setAttribute('class', 'wikilink')
    } else {
      // The app never navigates away; external links are shown but inert.
      node.removeAttribute('href')
      if (href) node.setAttribute('title', href)
      node.setAttribute('class', 'ext-link')
    }
  })
}

/**
 * Markdown of an untrusted text to safe HTML: no wikilinks, links are inert, code blocks are marked. A `reply` (what a
 * model wrote) gets its missing blank lines back and keeps single line breaks; a `doc` is rendered as written.
 */
export function renderMarkdown(text: string, kind: 'reply' | 'doc' = 'reply'): string {
  hook()
  const html = kind === 'reply' ? mdReply.render(tidyMarkdown(text)) : md.render(text)
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    FORBID_TAGS: ['style', 'form', 'input', 'img', 'iframe', 'object', 'embed', 'svg', 'math', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'srcset', 'src']
  })
}

/** Markdown of an untrusted note to safe HTML. Wikilinks carry `data-note`; other links are inert. */
export function renderNote(text: string): string {
  hook()
  return DOMPurify.sanitize(md.render(prepare(text)), {
    ALLOWED_URI_REGEXP: /^(?:mc-note:|https?:|mailto:)/i,
    FORBID_TAGS: ['style', 'form', 'input', 'img', 'iframe', 'object', 'embed', 'svg', 'math', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'srcset', 'src']
  })
}
