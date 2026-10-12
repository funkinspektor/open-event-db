'use client'

import { useEffect, useRef, useState } from 'react'
import type { EventDraft } from '@open-event-db/shared'
import { ImageError, prepareImage } from '@/lib/image'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const MESSAGES: Record<string, string> = {
  nothing_extracted: 'No event details found in this image. Fill in the form below instead.',
  extraction_failed: 'The image couldn’t be read. Fill in the form below instead.',
  extraction_timeout: 'Reading the image took too long. Try again, or fill in the form below.',
  extraction_provider_error: 'The image couldn’t be read right now. Try again later, or fill in the form below.',
  extraction_unavailable: 'Image import isn’t available right now. Fill in the form below instead.',
  rate_limited: 'You’ve reached today’s limit of image imports. Fill in the form below, or try again tomorrow.',
  unauthorized: 'Your session has expired. Log in again to import an image.',
  payload_too_large: 'This image is too large. Try a screenshot of the relevant part.',
  unsupported_media_type: 'Please choose a PNG, JPEG or WEBP image.',
}

interface Props {
  /** Called with the extracted draft; the import stays busy until it resolves (venue lookup etc.). */
  onImported: (draft: EventDraft) => Promise<void>
  onBusyChange?: (busy: boolean) => void
  /** After a successful import the panel shrinks to a "use another image" line. */
  compact?: boolean
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

/** "Import from flyer or screenshot": file picker, drag-and-drop and paste. The image never leaves the request. */
export function EventImport({ onImported, onBusyChange, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusyState] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  const setBusy = (next: boolean) => {
    busyRef.current = next
    setBusyState(next)
    onBusyChange?.(next)
  }

  async function run(file: File) {
    if (busyRef.current) return
    setError(null)
    setBusy(true)
    try {
      const image = await prepareImage(file)
      const res = await fetch(`${API_URL}/api/v1/events/extract`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': image.type },
        body: image,
      })
      const json = (await res.json().catch(() => null)) as { data?: EventDraft; error?: { code: string } } | null
      if (!res.ok || !json?.data) {
        const code = json?.error?.code ?? (res.status === 401 ? 'unauthorized' : '')
        setError(MESSAGES[code] ?? 'The image couldn’t be read. Fill in the form below instead.')
        return
      }
      await onImported(json.data)
    } catch (err) {
      setError(err instanceof ImageError ? err.message : 'The image couldn’t be uploaded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  // Paste an image anywhere on the page, unless the cursor is in a text field
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      void run(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImported])

  const picker = (
    <input
      ref={inputRef}
      type="file"
      // No `capture`: phones then offer camera *and* photo library (screenshots live there)
      accept="image/*,.heic,.heif"
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) void run(file)
      }}
    />
  )

  const errorBox = error && (
    <div className="kk-alert" role="alert">
      {error}
    </div>
  )

  if (compact && !busy) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => inputRef.current?.click()} className="kk-btn kk-btn--text">
            Use a different image
          </button>
          {picker}
        </div>
        {errorBox}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="Import from flyer or screenshot"
        aria-busy={busy}
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void run(file)
        }}
        className="kk-dropzone"
      >
        <div className="min-w-0 flex-[1_1_280px]">
          <p className="kk-eyebrow kk-eyebrow--live">Shortcut</p>
          <h2 className="kk-dropzone__title">Import from flyer or screenshot</h2>
          <p className="kk-hint m-0">
            {busy
              ? 'Reading your image…'
              : 'Take a photo, pick a screenshot, drop a file here or paste it. We fill in the form for you to check — the image isn’t stored.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="kk-btn kk-btn--outline shrink-0"
        >
          {busy ? (
            <>
              <span className="kk-spinner" aria-hidden /> Reading…
            </>
          ) : (
            'Choose image'
          )}
        </button>
        {picker}
      </section>
      {errorBox}
    </div>
  )
}
