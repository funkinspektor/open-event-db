'use client'

import { useEffect, useRef, useState } from 'react'
import { EXTRACT_MAX_BYTES, EXTRACT_MAX_IMAGES, type EventDraft } from '@open-event-db/shared'
import { ImageError, prepareImage } from '@/lib/image'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const MESSAGES: Record<string, string> = {
  nothing_extracted: 'No event details found in these images. Fill in the form below instead.',
  extraction_failed: 'The images couldn’t be read. Fill in the form below instead.',
  extraction_timeout: 'Reading the images took too long. Try again, or fill in the form below.',
  extraction_provider_error: 'The images couldn’t be read right now. Try again later, or fill in the form below.',
  extraction_unavailable: 'Image import isn’t available right now. Fill in the form below instead.',
  rate_limited: 'You’ve reached today’s limit of image imports. Fill in the form below, or try again tomorrow.',
  unauthorized: 'Your session has expired. Log in again to import images.',
  payload_too_large: 'These images are too large together — remove one and try again.',
  too_many_images: `You can use up to ${EXTRACT_MAX_IMAGES} images per import.`,
  unsupported_media_type: 'Please choose PNG, JPEG or WEBP images.',
}

interface Props {
  /** Called with the extracted draft; the import stays busy until it resolves (venue lookup etc.). */
  onImported: (draft: EventDraft, imageCount: number) => Promise<void>
  onBusyChange?: (busy: boolean) => void
  /** After a successful import the panel shrinks to a "use different images" line. */
  compact?: boolean
}

/** A prepared upload (cropped, downscaled JPEG) with a preview URL, or a placeholder while it's prepared. */
interface Shot {
  id: number
  blob?: Blob
  url?: string
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

let nextId = 1

/**
 * "Import from flyer or screenshots": collect one or more images of the same event (picker, drag-and-drop,
 * paste), then "Read event" sends them in one request. The images never leave the request.
 */
export function EventImport({ onImported, onBusyChange, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusyState] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "Use different images" reopens the full panel although the form already holds an import
  const [reopened, setReopened] = useState(false)
  const busyRef = useRef(false)
  const shotsRef = useRef<Shot[]>([])
  shotsRef.current = shots

  const setBusy = (next: boolean) => {
    busyRef.current = next
    setBusyState(next)
    onBusyChange?.(next)
  }

  // Free the preview URLs when the page goes away
  useEffect(() => () => shotsRef.current.forEach((s) => s.url && URL.revokeObjectURL(s.url)), [])

  function clear() {
    shotsRef.current.forEach((s) => s.url && URL.revokeObjectURL(s.url))
    setShots([])
  }

  function remove(id: number) {
    const shot = shotsRef.current.find((s) => s.id === id)
    if (shot?.url) URL.revokeObjectURL(shot.url)
    setShots((prev) => prev.filter((s) => s.id !== id))
  }

  async function add(files: File[]) {
    if (busyRef.current || !files.length) return
    setError(null)
    const room = EXTRACT_MAX_IMAGES - shotsRef.current.length
    if (files.length > room) setError(`You can use up to ${EXTRACT_MAX_IMAGES} images per import.`)
    const accepted = files.slice(0, Math.max(0, room)).map((file) => ({ file, id: nextId++ }))
    if (!accepted.length) return
    // Placeholders keep the selection order while the images are prepared in parallel
    setShots((prev) => [...prev, ...accepted.map(({ id }) => ({ id }))])
    await Promise.all(
      accepted.map(async ({ file, id }) => {
        try {
          const blob = await prepareImage(file)
          const url = URL.createObjectURL(blob)
          setShots((prev) => {
            if (!prev.some((s) => s.id === id)) URL.revokeObjectURL(url) // removed meanwhile
            return prev.map((s) => (s.id === id ? { id, blob, url } : s))
          })
        } catch (err) {
          setShots((prev) => prev.filter((s) => s.id !== id))
          setError(err instanceof ImageError ? err.message : 'This image can’t be read. Try a PNG, JPEG or WEBP file.')
        }
      }),
    )
  }

  async function read() {
    const ready = shotsRef.current.filter((s): s is Required<Shot> => !!s.blob)
    if (busyRef.current || !ready.length) return
    setError(null)
    if (ready.reduce((sum, s) => sum + s.blob.size, 0) > EXTRACT_MAX_BYTES) {
      setError(MESSAGES.payload_too_large!)
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      ready.forEach((s, i) => form.append('image', s.blob, `image-${i + 1}.jpg`))
      const res = await fetch(`${API_URL}/api/v1/events/extract`, { method: 'POST', credentials: 'include', body: form })
      const json = (await res.json().catch(() => null)) as { data?: EventDraft; error?: { code: string } } | null
      if (!res.ok || !json?.data) {
        const code = json?.error?.code ?? (res.status === 401 ? 'unauthorized' : res.status === 413 ? 'payload_too_large' : '')
        setError(MESSAGES[code] ?? 'The images couldn’t be read. Fill in the form below instead.')
        return
      }
      await onImported(json.data, ready.length)
      setReopened(false)
    } catch {
      setError('The images couldn’t be uploaded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  // Paste an image anywhere on the page, unless the cursor is in a text field
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      if (compact && !reopened) {
        clear()
        setReopened(true)
      }
      void add(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, reopened])

  const picker = (
    <input
      ref={inputRef}
      type="file"
      multiple
      // No `capture`: phones then offer camera *and* photo library (screenshots live there)
      accept="image/*,.heic,.heif"
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        const files = [...(e.target.files ?? [])]
        e.target.value = ''
        void add(files)
      }}
    />
  )

  const errorBox = error && (
    <div className="kk-alert" role="alert">
      {error}
    </div>
  )

  if (compact && !reopened && !busy) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => {
              clear()
              setError(null)
              setReopened(true)
              inputRef.current?.click()
            }}
            className="kk-btn kk-btn--text"
          >
            Use different images
          </button>
          {picker}
        </div>
        {errorBox}
      </div>
    )
  }

  const preparing = shots.some((s) => !s.blob)
  const full = shots.length >= EXTRACT_MAX_IMAGES

  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="Import from flyer or screenshots"
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
          void add([...e.dataTransfer.files])
        }}
        className="kk-dropzone"
      >
        <div className="min-w-0 flex-[1_1_280px]">
          <p className="kk-eyebrow kk-eyebrow--live">Shortcut</p>
          <h2 className="kk-dropzone__title">Import from flyer or screenshots</h2>
          <p className="kk-hint m-0">
            {busy
              ? `Reading your ${shots.length > 1 ? `${shots.length} images` : 'image'}…`
              : shots.length
                ? 'Add more screenshots of the same event if the details continue further down, then read the event.'
                : 'Take a photo, pick screenshots, drop files here or paste them. Several screenshots of one event work too. We fill in the form for you to check — the images aren’t stored.'}
          </p>
        </div>
        {shots.length === 0 && (
          <button type="button" onClick={() => inputRef.current?.click()} className="kk-btn kk-btn--outline shrink-0">
            Choose images
          </button>
        )}

        {shots.length > 0 && (
          <div className="flex w-full flex-col gap-4">
            <ul className="kk-thumbs" aria-label="Selected images">
              {shots.map((s, i) => (
                <li key={s.id} className="kk-thumb">
                  {s.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                    <img src={s.url} alt={`Image ${i + 1}`} />
                  ) : (
                    <span className="kk-skeleton h-full w-full" aria-label="Preparing image" />
                  )}
                  {!busy && (
                    <button
                      type="button"
                      className="kk-thumb__remove"
                      onClick={() => remove(s.id)}
                      aria-label={`Remove image ${i + 1}`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
              {!full && !busy && (
                <li>
                  <button type="button" className="kk-thumb kk-thumb--add" onClick={() => inputRef.current?.click()}>
                    <span aria-hidden>+</span>
                    <span className="sr-only">Add image</span>
                  </button>
                </li>
              )}
            </ul>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={() => void read()} disabled={busy || preparing} className="kk-btn kk-btn--primary">
                {busy ? (
                  <>
                    <span className="kk-spinner" aria-hidden /> Reading…
                  </>
                ) : (
                  'Read event'
                )}
              </button>
              {!busy && (
                <button
                  type="button"
                  className="kk-btn kk-btn--text"
                  onClick={() => {
                    clear()
                    setError(null)
                  }}
                >
                  Clear
                </button>
              )}
              <span className="kk-hint m-0">
                {shots.length} of {EXTRACT_MAX_IMAGES}
              </span>
            </div>
          </div>
        )}
        {picker}
      </section>
      {errorBox}
    </div>
  )
}
