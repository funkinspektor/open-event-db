'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { slugSchema, type AccountMembership } from '@open-event-db/shared'
import { LinksEditor, fromLinkRows, toLinkRows, type LinkRow } from './LinksEditor'
import { TickIcon } from './Icons'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const LINK_KEYS = ['website', 'instagram', 'telegram', 'soundcloud', 'bandcamp', 'ra', 'facebook']

type SlugState = 'current' | 'invalid' | 'checking' | 'available' | 'taken' | 'unknown'

// Positive validation is UV (kk-hint--ok); problems are plain sentences in ink.
const SLUG_HINT: Record<SlugState, { text: string; className: string }> = {
  current: { text: 'The current slug.', className: 'kk-hint' },
  invalid: {
    text: 'Lowercase letters, numbers and dashes only; no dash at the start or end.',
    className: 'kk-hint !text-ink',
  },
  checking: { text: 'Checking…', className: 'kk-hint' },
  available: { text: 'Available', className: 'kk-hint kk-hint--ok' },
  taken: { text: 'This slug is already taken.', className: 'kk-hint !text-ink' },
  unknown: { text: 'Could not check availability — it will be checked on save.', className: 'kk-hint' },
}

/**
 * Edits one organizer the account is a member of. Members may edit, also while it awaits verification.
 * `links` is null when they can't be loaded (an unverified organizer has no public page); the form then leaves them alone.
 */
export function OrganizerForm({ organizer, links: initialLinks }: { organizer: AccountMembership; links: Record<string, string> | null }) {
  const router = useRouter()
  const [name, setName] = useState(organizer.name)
  const [slug, setSlug] = useState(organizer.slug)
  const [links, setLinks] = useState<LinkRow[]>(toLinkRows(initialLinks ?? {}))
  const [slugState, setSlugState] = useState<SlugState>('current')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (slug === organizer.slug) return setSlugState('current')
    if (!slugSchema.safeParse(slug).success) return setSlugState('invalid')

    setSlugState('checking')
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/organizers/check-slug?slug=${encodeURIComponent(slug)}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) return setSlugState('unknown')
        const json = (await res.json()) as { data: { available: boolean } }
        setSlugState(json.data.available ? 'available' : 'taken')
      } catch {
        if (!ctrl.signal.aborted) setSlugState('unknown')
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [slug, organizer.slug])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)

    if (slug !== organizer.slug) {
      const ok = window.confirm(
        `The public page will move to /organizers/${slug}. Links to /organizers/${organizer.slug} will stop working.`,
      )
      if (!ok) return
    }

    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/organizers/${organizer.slug}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, slug, ...(initialLinks ? { links: fromLinkRows(links) } : {}) }),
      })
      const json = (await res.json()) as { data?: unknown; error?: { message: string } }
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `Request failed (${res.status})`)
        return
      }
      setSaved(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const slugBlocked = slugState === 'invalid' || slugState === 'taken' || slugState === 'checking'

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="kk-panel">
        <label className="kk-field">
          Organizer name
          <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className="kk-input" />
        </label>

        <label className="kk-field">
          Slug
          <span className="kk-affix">
            <span className="kk-affix__pre">/organizers/</span>
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              className="kk-input"
              autoComplete="off"
              spellCheck={false}
            />
          </span>
          <span className={SLUG_HINT[slugState].className}>
            {slugState === 'available' && (
              <>
                <TickIcon size={12} />{' '}
              </>
            )}
            {SLUG_HINT[slugState].text}
          </span>
        </label>

        {initialLinks && (
          <div className="kk-field">
            Links
            <LinksEditor rows={links} onChange={setLinks} suggestedKeys={LINK_KEYS} />
          </div>
        )}
      </div>

      {error && (
        <div className="kk-alert" role="alert">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4">
        <button type="submit" disabled={busy || slugBlocked} className="kk-btn kk-btn--primary kk-btn--lg">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="kk-hint kk-hint--ok text-[14px] font-bold">Saved.</span>}
      </div>
    </form>
  )
}
