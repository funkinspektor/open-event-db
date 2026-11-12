import { describe, expect, it } from 'vitest'
import { ipKey } from './ip-key.js'

describe('ipKey', () => {
  it('keeps IPv4 addresses', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7')
  })

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(ipKey('::ffff:1.2.3.4')).toBe('1.2.3.4')
    expect(ipKey('::FFFF:1.2.3.4')).toBe('1.2.3.4')
  })

  it('reduces a full IPv6 address to its /64', () => {
    expect(ipKey('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64')
  })

  it('expands compressed IPv6 addresses', () => {
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipKey('::1')).toBe('0:0:0:0::/64')
    expect(ipKey('2001:db8:1:2::')).toBe('2001:db8:1:2::/64')
    expect(ipKey('::')).toBe('0:0:0:0::/64')
  })

  it('gives two addresses in one /64 the same key, and different /64s different keys', () => {
    expect(ipKey('2001:db8:1:2::1')).toBe(ipKey('2001:db8:1:2:ffff:ffff:ffff:ffff'))
    expect(ipKey('2001:db8:1:2::1')).not.toBe(ipKey('2001:db8:1:3::1'))
  })
})
