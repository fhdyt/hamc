// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import { prepare, renderNote, stripFrontmatter } from '../../src/renderer/lib/brain/markdown'
import { resolveNoteId } from '../../src/renderer/lib/brain/graphModel'
import { sampleNote } from '../helpers/samples'

const html = (md: string): HTMLElement => {
  const d = document.createElement('div')
  d.innerHTML = renderNote(md)
  return d
}

describe('stripFrontmatter and prepare', () => {
  it('drops a leading YAML block only', () => {
    expect(stripFrontmatter('---\ntags: [a]\n---\nbody')).toBe('body')
    expect(stripFrontmatter('text\n---\nnot: front\n---\n')).toBe('text\n---\nnot: front\n---\n')
    expect(stripFrontmatter('---\nnever closed')).toBe('---\nnever closed')
  })

  it('rewrites wikilinks and embeds, strips heading and block suffixes, keeps code alone', () => {
    const out = prepare('See [[Alpha]], [[Beta|the beta]], [[Gamma#Part]] and ![[Pic]].\n`[[InCode]]`\n```\n[[Fenced]]\n```')
    expect(out).toContain('[Alpha](mc-note:Alpha)')
    expect(out).toContain('[the beta](mc-note:Beta)')
    expect(out).toContain('[Gamma#Part](mc-note:Gamma)')
    expect(out).toContain('[↪ Pic](mc-note:Pic)')
    expect(out).toContain('`[[InCode]]`')
    expect(out).toContain('[[Fenced]]')
  })
})

describe('renderNote', () => {
  it('renders markdown and wikilinks as followable links', () => {
    const d = html('# Title\n\nSome **bold** and [[Note with space|alias]].')
    expect(d.querySelector('h1')?.textContent).toBe('Title')
    expect(d.querySelector('strong')?.textContent).toBe('bold')
    const a = d.querySelector('a.wikilink')!
    expect(a.getAttribute('data-note')).toBe('Note with space')
    expect(a.textContent).toBe('alias')
  })

  it('removes scripts, event handlers, raw html, images, iframes and styles', () => {
    const d = html('<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="http://evil"></iframe><style>*{}</style><b onclick="x()">hi</b>\n\n![pic](http://evil/x.png)')
    expect(d.querySelector('script, img, iframe, style')).toBeNull()
    expect(html('<b onclick="x()">hi</b>').querySelector('b, [onclick]')).toBeNull() // raw html is shown as text, never as markup
    expect(d.textContent).toContain('[image: pic]')
  })

  it('makes javascript: and other links inert, and shows where web links point', () => {
    const d = html('[bad](javascript:alert(1)) [web](https://example.com/x) [mail](mailto:a@b.c) [data](data:text/html,x)')
    const links = [...d.querySelectorAll('a')]
    expect(links.every((a) => !a.hasAttribute('href') || a.getAttribute('href') === '#')).toBe(true)
    const web = links.find((a) => a.textContent === 'web')!
    expect(web.getAttribute('title')).toBe('https://example.com/x')
    expect(web.className).toBe('ext-link')
    expect(links.find((a) => a.textContent === 'bad')?.getAttribute('title') ?? '').not.toContain('javascript') // dropped before the hook
  })

  it('escapes html in text', () => {
    expect(renderNote('a < b & <u>c</u>')).not.toContain('<u>')
  })
})

describe('resolveNoteId', () => {
  const notes = [
    sampleNote({ id: 'Alpha.md', aliases: ['First'] }),
    sampleNote({ id: 'folder/Alpha.md' }),
    sampleNote({ id: 'x/deep/Plan.md' }),
    sampleNote({ id: 'Index.md' })
  ]
  it('matches by name, case-insensitively, preferring the shortest path', () => {
    expect(resolveNoteId(notes, 'alpha')).toBe('Alpha.md')
    expect(resolveNoteId(notes, 'ALPHA.md')).toBe('Alpha.md')
  })
  it('matches by path suffix and by alias', () => {
    expect(resolveNoteId(notes, 'deep/Plan')).toBe('x/deep/Plan.md')
    expect(resolveNoteId(notes, 'folder/alpha')).toBe('folder/Alpha.md')
    expect(resolveNoteId(notes, 'first')).toBe('Alpha.md')
  })
  it('returns null for nothing, an empty target and unknown names', () => {
    expect(resolveNoteId(notes, 'Nope')).toBeNull()
    expect(resolveNoteId(notes, '  ')).toBeNull()
    expect(resolveNoteId([], 'Alpha')).toBeNull()
  })
})
