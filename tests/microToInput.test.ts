import { describe, expect, it } from 'vitest'
import { fromMicro, microToInput, toMicro } from 'lib/dex'

describe('microToInput', () => {
  it('gives back exactly the amount a field turns into smallest units', () => {
    // The two ROAR pools a provider could not leave on 2026-11-04, and the three that kept a fraction behind.
    for (const lp of ['2271519449', '2074704180', '18708285933', '16208021704', '17581119282']) {
      expect(toMicro(microToInput(lp, 6), 6)).toBe(lp)
    }
    expect(microToInput('2271519449', 6)).toBe('2271.519449')
    // fromMicro, for reading, is what rounded them: up past the balance, or down leaving the rest.
    expect(fromMicro('2271519449', 6, 6)).toBe('2,272')
    expect(fromMicro('18708285933', 6, 6)).toBe('18,708')
  })

  it('handles small, whole, high-decimal and bigint amounts', () => {
    expect(microToInput('1', 6)).toBe('0.000001')
    expect(microToInput('0', 6)).toBe('0')
    expect(microToInput('5000000', 6)).toBe('5')
    expect(microToInput('1234567890123456789', 18)).toBe('1.234567890123456789')
    expect(microToInput('12345678', 8)).toBe('0.12345678')
    expect(microToInput(BigInt('999000'), 6)).toBe('0.999')
    expect(microToInput('42', 0)).toBe('42')
    for (const [m, d] of [['1', 6], ['1234567890123456789', 18], ['100000001', 8]] as const) expect(toMicro(microToInput(m, d), d)).toBe(m)
  })

  it('returns nothing for something that is not an amount', () => {
    expect(microToInput('', 6)).toBe('')
    expect(microToInput('-5', 6)).toBe('')
    expect(microToInput('1.5', 6)).toBe('')
  })
})
