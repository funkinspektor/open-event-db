'use client'

import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** webcal:// makes the OS hand the feed to the default calendar app. */
const toWebcal = (url: string) => url.replace(/^https?:\/\//, 'webcal://')

async function call(path: string, method: 'GET' | 'POST'): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/v1/accounts/me/${path}`, { method, credentials: 'include' })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return ((await res.json()) as { data: { url: string | null } }).data.url
}

/**
 * "Add to calendar" for the My events view: opens a panel with the account's private iCal subscription link
 * (created on first use) to open in a calendar app, copy, or replace with a new one.
 */
export function CalendarPanel() {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (open) return setOpen(false)
    setOpen(true)
    if (url) return
    setBusy(true)
    setError(null)
    try {
      setUrl((await call('calendar', 'GET')) ?? (await call('calendar-token', 'POST')))
    } catch {
      setError('Couldn’t load your calendar link. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    if (!window.confirm('The old link stops working in your calendar apps. Continue?')) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      setUrl(await call('calendar-token', 'POST'))
    } catch {
      setError('Couldn’t create a new link. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setError('Could not copy — select the link and copy it manually.')
    }
  }

  return (
    <div>
      <button type="button" className="kk-btn kk-btn--outline" aria-expanded={open} onClick={toggle}>
        Add to calendar
      </button>
      {open && (
        <div className="kk-calendar">
          <p className="m-0 text-[15px] text-muted">
            Your My events as a calendar. Subscribe once and it stays up to date. Keep the link private: anyone with
            it can see your events.
          </p>
          {busy && !url && <p className="kk-hint m-0">Loading…</p>}
          {url && (
            <>
              <div className="kk-calendar__row">
                <a href={toWebcal(url)} className="kk-btn kk-btn--primary">
                  Open in calendar app
                </a>
                <button type="button" className="kk-btn kk-btn--secondary" onClick={copy}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button type="button" className="kk-btn kk-btn--text" onClick={rotate} disabled={busy}>
                  New link
                </button>
              </div>
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="kk-input kk-input--mono w-full min-w-0"
                aria-label="Calendar link"
              />
              <p className="kk-hint m-0">In Google Calendar: Other calendars → From URL, paste the link.</p>
            </>
          )}
          {error && <p className="kk-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
