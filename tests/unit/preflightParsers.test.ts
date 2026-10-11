import { describe, expect, it } from 'vitest'
import { compareVersions, parseShebang, parseVersion, shortFingerprint } from '../../src/main/connection/preflight'

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
