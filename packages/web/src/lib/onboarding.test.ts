import { describe, expect, it } from 'vitest'
import type { AccountMe } from '@open-event-db/shared'
import { needsWelcome } from './onboarding'

const me = (onboarded: boolean) => ({ onboarded }) as AccountMe

describe('needsWelcome', () => {
  it('is false for anonymous visitors', () => {
    expect(needsWelcome('/', null)).toBe(false)
  })
  it('is false for onboarded accounts', () => {
    expect(needsWelcome('/dashboard', me(true))).toBe(false)
  })
  it('is true for a non-onboarded account on normal pages', () => {
    expect(needsWelcome('/', me(false))).toBe(true)
    expect(needsWelcome('/events/new?x=1', me(false))).toBe(true)
    expect(needsWelcome('/profile', me(false))).toBe(true)
  })
  it.each([
    '/welcome',
    '/welcome?return_to=%2F',
    '/goodbye',
    '/impressum',
    '/datenschutz',
    '/nutzungsbedingungen',
    '/lizenz',
    '/_next/static/x.js',
  ])('lets %s through', (path) => {
    expect(needsWelcome(path, me(false))).toBe(false)
  })
  it('does not let look-alike prefixes through', () => {
    expect(needsWelcome('/welcomeX', me(false))).toBe(true)
    expect(needsWelcome('/impressum-evil', me(false))).toBe(true)
  })
})
