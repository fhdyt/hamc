// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { tidyMarkdown } from '../../src/renderer/lib/chatMarkdown'
import { renderMarkdown } from '../../src/renderer/lib/brain/markdown'

const html = (t: string): string => renderMarkdown(t)

describe('tidyMarkdown', () => {
  it('turns a table that sticks to a list into a real table', () => {
    const t = '- CPU: 12%\n- RAM: 40%\n| Agent | Status |\n|---|---|\n| default | ok |\nNext steps:'
    const out = html(t)
    expect(out).toContain('<table>')
    expect(out).toContain('<td>default</td>')
    expect(out).not.toContain('|---|')
    expect(out).toMatch(/<\/table>\s*<p>Next steps:<\/p>/)
  })

  it('keeps a rule a rule instead of making the line above a heading', () => {
    const out = html('Line one\nLine two\n---\nDone.')
    expect(out).not.toContain('<h2>')
    expect(out).toContain('<hr>')
    expect(out).toContain('Line one<br>\nLine two')
  })

  it('ends a list before a plain line instead of joining the last item', () => {
    const out = html('Steps:\n1. Check the log\n2. Restart\nThat is all.')
    expect(out).toMatch(/<\/ol>\s*<p>That is all\.<\/p>/)
    expect(out).toContain('<li>Restart</li>')
  })

  it('lets an ordered list that does not start at 1 follow a paragraph', () => {
    expect(html('Then:\n3. third\n4. fourth')).toMatch(/<p>Then:<\/p>\s*<ol[ >]/)
  })

  it('makes bullets from • lines', () => {
    expect(html('Results:\n• one\n• two')).toContain('<li>one</li>')
  })

  it('keeps nested list lines inside their item', () => {
    const out = html('- parent\n  - child\n  more text\n- next')
    expect(out).toContain('<li>child')
    expect((out.match(/<ul>/g) ?? []).length).toBe(2)
  })

  it('never touches code blocks', () => {
    const t = 'Run:\n```bash\n| not | a table |\n|---|---|\n---\n```\nok'
    expect(tidyMarkdown(t)).toBe('Run:\n\n```bash\n| not | a table |\n|---|---|\n---\n```\nok')
    expect(html(t)).toContain('| not | a table |')
  })

  it('leaves text that is already well formed as it is', () => {
    const t = '# Title\n\nSome text.\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n'
    expect(tidyMarkdown(t)).toBe(t)
  })

  it('separates a heading from the line under it', () => {
    expect(tidyMarkdown('### Notes\nfirst line')).toBe('### Notes\n\nfirst line')
  })
})

describe('documents', () => {
  it('render as written (no tidying, no single line breaks)', () => {
    expect(renderMarkdown('a\nb', 'doc')).toBe('<p>a\nb</p>\n')
    expect(renderMarkdown('a\nb')).toBe('<p>a<br>\nb</p>\n')
  })
})
