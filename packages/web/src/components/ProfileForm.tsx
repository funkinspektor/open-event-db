'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { slugSchema, type PublisherMe } from '@open-event-db/shared'
import { LinksEditor, fromLinkRows, toLinkRows, type LinkRow } from './LinksEditor'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const LINK_KEYS = ['website', 'instagram', 'telegram', 'soundcloud', 'bandcamp', 'ra', 'facebook']

const input =
  'mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:bg-neutral-50 disabled:text-neutral-500'
const label = 'block text-sm font-medium text-neutral-800'

type SlugState = 'current' | 'invalid' | 'checking' | 'available' | 'taken' | 'unknown'

const SLUG_HINT: Record<SlugState, { text: string; className: string }> = {
  current: { text: 'Your current slug.', className: 'text-neutral-500' },
  invalid: {
    text: 'Lowercase letters, numbers and dashes only; no dash at the start or end.',
    className: 'text-red-600',
  },
  checking: { text: 'Checking…', className: 'text-neutral-500' },
  available: { text: 'Available.', className: 'text-emerald-700' },
  taken: { text: 'This slug is already taken.', className: 'text-red-600' },
  unknown: { text: 'Could not check availability — it will be checked on save.', className: 'text-neutral-500' },
}

export function ProfileForm({ me }: { me: PublisherMe }) {
  const router = useRouter()
  const [name, setName] = useState(me.name)
  const [slug, setSlug] = useState(me.slug)
  const [links, setLinks] = useState<LinkRow[]>(toLinkRows(me.links))
  const [slugState, setSlugState] = useState<SlugState>('current')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (slug === me.slug) return setSlugState('current')
    if (!slugSchema.safeParse(slug).success) return setSlugState('invalid')

    setSlugState('checking')
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/publishers/check-slug?slug=${encodeURIComponent(slug)}`, {
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
  }, [slug, me.slug])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)

    if (slug !== me.slug) {
      const ok = window.confirm(
        `Your public profile will move to /publishers/${slug}. Links to /publishers/${me.slug} will stop working.`,
      )
      if (!ok) return
    }

    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/api/v1/publishers/me`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, slug, links: fromLinkRows(links) }),
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
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6">
        <label className={label}>
          Name
          <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>

        <label className={label}>
          Slug
          <div className="mt-1 flex items-stretch overflow-hidden rounded-md border border-neutral-300 shadow-sm focus-within:border-neutral-900 focus-within:ring-1 focus-within:ring-neutral-900">
            <span className="flex items-center border-r border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-500">
              /publishers/
            </span>
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              className="w-full px-3 py-2 text-sm focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <span className={`mt-1 block text-xs font-normal ${SLUG_HINT[slugState].className}`}>
            {SLUG_HINT[slugState].text}
          </span>
        </label>

        <label className={label}>
          Email
          <input value={me.email} disabled className={input} />
          <span className="mt-1 block text-xs font-normal text-neutral-500">
            Used for login links. Can’t be changed yet.
          </span>
        </label>

        <div>
          <span className={label}>Links</span>
          <LinksEditor rows={links} onChange={setLinks} suggestedKeys={LINK_KEYS} inputClassName={input} />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || slugBlocked}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <span className="text-sm text-emerald-700">Saved.</span>}
      </div>
    </form>
  )
}
