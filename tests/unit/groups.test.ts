import { describe, expect, it } from 'vitest'
import {
  ENTRY_CHARS,
  GROUP_ID_RE,
  cleanGroupName,
  cutEntry,
  formatLine,
  groupIdOfTitle,
  groupTitle,
  isPass,
  mentionForms,
  newGroupId,
  parseMentions,
  responders,
  rotate,
  turnPrompt,
  type GroupEntry,
  type GroupMember
} from '@shared/groups'

const ada: GroupMember = { profile: 'ada', name: 'Ada' }
const bo: GroupMember = { profile: 'bo', name: 'Research Buddy' }
const cy: GroupMember = { profile: 'cy', name: 'cy' }
const members = [ada, bo, cy]

let seq = 0
const e = (author: string, text: string, status: GroupEntry['status'] = 'ok'): GroupEntry => ({ seq: ++seq, author, text, status, ts: seq })

describe('ids and names', () => {
  it('makes distinct ids that match the regex', () => {
    const a = newGroupId()
    const b = newGroupId()
    expect(a).toMatch(GROUP_ID_RE)
    expect(b).toMatch(GROUP_ID_RE)
    expect(a).not.toBe(b)
    expect(GROUP_ID_RE.test('mc-ABCDEFGHIJ')).toBe(false)
  })

  it('cleans a room name', () => {
    expect(cleanGroupName('  Ops   room ')).toBe('Ops room')
    expect(cleanGroupName('   ')).toBeNull()
    expect(cleanGroupName('x'.repeat(61))).toBeNull()
    expect(cleanGroupName('a\u0007b')).toBeNull()
  })

  it('titles member sessions by the room id', () => {
    expect(groupTitle('mc-abcdefghij')).toBe('Group: mc-abcdefghij')
    expect(groupIdOfTitle('Group: mc-abcdefghij')).toBe('mc-abcdefghij')
    expect(groupIdOfTitle('Group: Ops · t1')).toBeNull()
  })
})

describe('mentions', () => {
  it('knows the profile, the slugged and collapsed name and its first word', () => {
    expect(mentionForms(bo)).toEqual(expect.arrayContaining(['bo', 'research-buddy', 'researchbuddy', 'research']))
  })

  it('finds members, everyone and the user', () => {
    expect(parseMentions('hey @ADA and @"Research Buddy"', members)).toEqual({ mentioned: ['ada', 'bo'], everyone: false, user: false })
    expect(parseMentions('@researchbuddy, @research-buddy.', members).mentioned).toEqual(['bo'])
    expect(parseMentions('@everyone look', members).everyone).toBe(true)
    expect(parseMentions('@all', members).everyone).toBe(true)
    expect(parseMentions('ask @user please', members).user).toBe(true)
    expect(parseMentions('mail ada@ada.com or @nobody', members)).toEqual({ mentioned: [], everyone: false, user: false })
  })

  it('picks the speakers from the messages since the last user message', () => {
    expect(responders([e('user', 'hi all')], members).map((m) => m.profile)).toEqual(['ada', 'bo', 'cy'])
    expect(responders([e('user', '@bo first'), e('user', 'what do you think @cy')], members).map((m) => m.profile)).toEqual(['cy'])
    expect(responders([e('user', '@bo go'), e('bo', 'ok, @ada can you check?')], members).map((m) => m.profile)).toEqual(['ada', 'bo'])
    expect(responders([e('user', '@bo and @everyone')], members)).toHaveLength(3)
    expect(responders([e('user', '@ada hi'), e('ada', 'hello', 'pass')], members).map((m) => m.profile)).toEqual(['ada'])
  })

  it('rotates the speakers', () => {
    expect(rotate([1, 2, 3], 0)).toEqual([1, 2, 3])
    expect(rotate([1, 2, 3], 1)).toEqual([2, 3, 1])
    expect(rotate([1, 2, 3], 4)).toEqual([2, 3, 1])
    expect(rotate([1], 2)).toEqual([1])
  })
})

describe('prompt', () => {
  const names = { ada: 'Ada', bo: 'Research Buddy', user: 'You' }
  it('formats room lines as the viewer sees them', () => {
    expect(formatLine(e('user', 'hi'), 'ada', names)).toBe('You (user): hi')
    expect(formatLine(e('bo', 'x'), 'ada', names)).toBe('Research Buddy: x')
    expect(formatLine(e('ada', 'x'), 'ada', names)).toBe('Ada (you): x')
    expect(formatLine(e('bo', 'y'.repeat(3000)), 'ada', names).length).toBeLessThan(2100)
  })

  it('builds the Hermes Desktop turn prompt', () => {
    const p = turnPrompt({ roomName: 'Ops', members, viewer: ada, lines: ['You (user): hi', 'Research Buddy: hello'] })
    expect(p.startsWith('[Group chat: "Ops"] You are @ada, one participant in a group chat with Research Buddy (@bo), cy (@cy) and the user.')).toBe(true)
    expect(p).toContain('\n  You (user): hi\n  Research Buddy: hello\n')
    expect(p).toContain('reply with exactly "(pass)"')
    expect(p).toContain('mention @user only for a judgment call')
  })

  it('tells a pass from a reply', () => {
    for (const t of ['(pass)', ' PASS ', 'pass.', '[pass]', '', '  ']) expect(isPass(t)).toBe(true)
    expect(isPass('I pass this to @bo')).toBe(false)
  })

  it('cuts long replies', () => {
    expect(cutEntry('a'.repeat(ENTRY_CHARS + 50))).toHaveLength(ENTRY_CHARS)
    expect(cutEntry('short')).toBe('short')
  })
})
