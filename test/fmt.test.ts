import { describe, it, expect } from 'vitest'
import { fmtDur, fmtTok } from '../src/fmt'

describe('fmtDur', () => {
  it('seconds / minutes / hours', () => {
    expect(fmtDur(0)).toBe('0s')
    expect(fmtDur(45)).toBe('45s')
    expect(fmtDur(180)).toBe('3m')
    expect(fmtDur(721)).toBe('12m1s')
    expect(fmtDur(3600)).toBe('1h')
    expect(fmtDur(3725)).toBe('1h2m')
  })
})

describe('fmtTok', () => {
  it('exact / k / M with trimmed integers', () => {
    expect(fmtTok(0)).toBe('0')
    expect(fmtTok(842)).toBe('842')
    expect(fmtTok(1000)).toBe('1k')
    expect(fmtTok(1200)).toBe('1.2k')
    expect(fmtTok(74602)).toBe('74.6k')
    expect(fmtTok(383286)).toBe('383.3k')
    expect(fmtTok(1300000)).toBe('1.3M')
  })
})
