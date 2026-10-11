import { describe, expect, it } from 'vitest'
import { compareVersions, parsePythonVersion, parseShebang, parseVersion, resolvePython, shortFingerprint } from '../../src/main/connection/preflight'
import type { Execer } from '../../src/main/connection/manager'

describe('parseShebang', () => {
  it.each([
    ['#!/usr/bin/python3', '/usr/bin/python3'],
    ['#!/home/u/.hermes/venv/bin/python3.11\n', '/home/u/.hermes/venv/bin/python3.11'],
    ['#!/usr/bin/env python3', 'python3'],
    ['#! /usr/bin/env -S python3 -u', 'python3'],
    ['#!/bin/sh', '/bin/sh'],
    ['not a shebang', null],
    ['#!', null]
  ])('%j -> %j', (line, expected) => {
    expect(parseShebang(line)).toBe(expected)
  })
})

describe('parseVersion', () => {
  it.each([
    ['Hermes Agent v0.21.6', '0.21.6'],
    ['hermes 0.21', '0.21'],
    ['Python 3.11.9', '3.11.9'],
    ['no digits', null]
  ])('%j -> %j', (text, expected) => {
    expect(parseVersion(text)).toBe(expected)
  })
})

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.21.6', '0.21.0')).toBeGreaterThan(0)
    expect(compareVersions('0.9.0', '0.21.0')).toBeLessThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('shortFingerprint', () => {
  it('keeps the prefix, four chars and the tail', () => {
    expect(shortFingerprint('SHA256:Xq3vR8kP2mWfN0aJ7cLzQyT5uE1bHdG4sK9oV6iY9fA')).toBe('SHA256:Xq3v…9fA')
  })
})

describe('parsePythonVersion', () => {
  it('reads only the output of Python itself', () => {
    expect(parsePythonVersion('Python 3.11.15')).toBe('3.11.15')
    expect(parsePythonVersion('Python 3.8')).toBe('3.8')
    expect(parsePythonVersion('GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)')).toBeNull()
    expect(parsePythonVersion('dash 0.5.12')).toBeNull()
    expect(parsePythonVersion('')).toBeNull()
  })
})

describe('resolvePython', () => {
  /** A server where `answers` maps a program to what `<program> --version` prints; the shebang line is given too. */
  const server = (shebang: string, answers: Record<string, string>): { conn: Execer; asked: string[] } => {
    const asked: string[] = []
    const conn: Execer = {
      exec: async (argv) => {
        if (argv[0] === 'head') return { code: 0, stdout: shebang + '\n', stderr: '' }
        asked.push(argv[0]!)
        const out = answers[argv[0]!]
        return out === undefined ? { code: 127, stdout: '', stderr: 'not found' } : { code: 0, stdout: out + '\n', stderr: '' }
      }
    }
    return { conn, asked }
  }
  const HOME = '/home/ubuntu/.hermes'
  const VENV = `${HOME}/hermes-agent/venv/bin/python3`

  it('does not take bash for Python when hermes is a bash script (the report that started this)', async () => {
    const { conn, asked } = server('#!/usr/bin/env bash', { bash: 'GNU bash, version 5.2.21(1)-release', [VENV]: 'Python 3.11.15', python3: 'Python 3.12.3' })
    expect(await resolvePython(conn, '/home/ubuntu/.local/bin/hermes', HOME)).toEqual({ path: VENV, version: '3.11.15' })
    expect(asked).not.toContain('bash')
  })

  it('uses the shebang when it names Python, with or without env', async () => {
    const a = server('#!/home/u/venv/bin/python3.11', { '/home/u/venv/bin/python3.11': 'Python 3.11.2' })
    expect(await resolvePython(a.conn, '/x/hermes', HOME)).toEqual({ path: '/home/u/venv/bin/python3.11', version: '3.11.2' })
    const b = server('#!/usr/bin/env python3', { python3: 'Python 3.10.12' })
    expect(await resolvePython(b.conn, '/x/hermes', null)).toEqual({ path: 'python3', version: '3.10.12' })
  })

  it('falls back to python3, then python, and refuses Python 2 and anything that is not Python', async () => {
    expect(await resolvePython(server('#!/bin/sh', { python3: 'Python 3.9.18' }).conn, '/x/hermes', HOME)).toEqual({ path: 'python3', version: '3.9.18' })
    expect(await resolvePython(server('#!/bin/sh', { python3: 'Python 3.6.9', python: 'Python 3.12.1' }).conn, null, null)).toEqual({ path: 'python', version: '3.12.1' })
    expect(await resolvePython(server('#!/bin/sh', { python: 'Python 2.7.18' }).conn, null, null)).toBeNull()
    expect(await resolvePython(server('#!/bin/sh', { bash: 'GNU bash, version 5', python3: 'weird 9.9' }).conn, '/x/hermes', HOME)).toBeNull()
  })
})
