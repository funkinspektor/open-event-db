'use client'

import { useRef, useState } from 'react'
import { ImageError, prepareImage } from '@/lib/image'

/** What happens to the event image on save. */
export type ImageChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; blob: Blob; preview: string }

interface Props {
  /** The saved image (edit mode), or null. */
  current: string | null
  value: ImageChange
  onChange: (v: ImageChange) => void
}

/** Event image field: add, replace or remove. The image is prepared (downscaled JPEG) right away, uploaded on save. */
export function EventImageInput({ current, value, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shown = value.kind === 'replace' ? value.preview : value.kind === 'remove' ? null : current

  function drop() {
    if (value.kind === 'replace') URL.revokeObjectURL(value.preview)
  }

  async function pick(file: File) {
    setError(null)
    setPreparing(true)
    try {
      const blob = await prepareImage(file)
      drop()
      onChange({ kind: 'replace', blob, preview: URL.createObjectURL(blob) })
    } catch (err) {
      setError(err instanceof ImageError ? err.message : 'This image can’t be read. Try a PNG, JPEG or WEBP file.')
    } finally {
      setPreparing(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="kk-field">
      <span>
        Image <span className="kk-field__opt">(optional)</span>
      </span>
      <div className="flex flex-wrap items-end gap-4">
        {shown && (
          <span className="kk-event-image w-[160px]">
            <img src={shown} alt="Event image" />
          </span>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={preparing}
            className="kk-btn kk-btn--outline"
          >
            {preparing ? 'Preparing…' : shown ? 'Replace image' : 'Add image'}
          </button>
          {shown && (
            <button
              type="button"
              onClick={() => {
                drop()
                onChange(current ? { kind: 'remove' } : { kind: 'keep' })
              }}
              className="kk-btn kk-btn--text"
            >
              Remove image
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void pick(file)
        }}
      />
      <span className="kk-hint">A flyer or photo. Shown on the event page, in lists and when the event is shared.</span>
      {error && <p className="kk-error">{error}</p>}
    </div>
  )
}
