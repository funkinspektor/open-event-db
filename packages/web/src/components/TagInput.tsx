'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { normalizeTags } from '@open-event-db/shared'

const MAX_TAGS = 20
const MAX_TAG_LENGTH = 50
const MAX_SUGGESTIONS = 8

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  knownTags: string[]
}

/** Tags as removable pills. Enter, comma or picking a suggestion adds a tag; Backspace on empty removes the last. */
export function TagInput({ value, onChange, knownTags }: Props) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const inputId = useId()

  const q = draft.trim().toLowerCase()
  const full = value.length >= MAX_TAGS
  const suggestions = knownTags
    .filter((t) => !value.includes(t) && (!q || t.includes(q)))
    .sort((a, b) => Number(b.startsWith(q)) - Number(a.startsWith(q)))
    .slice(0, MAX_SUGGESTIONS)

  useEffect(() => setActive(-1), [draft])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  function add(raw: string, refocus = true) {
    const parts = raw.split(',').map((t) => t.slice(0, MAX_TAG_LENGTH))
    onChange(normalizeTags([...value, ...parts]).slice(0, MAX_TAGS))
    setDraft('')
    if (refocus) inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const pick = active >= 0 ? suggestions[active] : draft
      if (pick?.trim()) add(pick)
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1))
    } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="kk-field">
      <label htmlFor={inputId}>
        Tags <span className="kk-field__opt">(optional)</span>
      </label>
      <div ref={boxRef} className="relative">
        <div className="kk-taginput" onClick={() => inputRef.current?.focus()}>
          {value.map((t) => (
            <span key={t} className="kk-tag">
              {t}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(value.filter((x) => x !== t))
                }}
                className="kk-tag__remove"
                aria-label={`Remove tag ${t}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            value={draft}
            onChange={(e) => {
              // Pasting "a, b, c" adds all complete entries at once.
              const v = e.target.value
              if (v.includes(',')) {
                const parts = v.split(',')
                add(parts.slice(0, -1).join(','))
                setDraft(parts[parts.length - 1]!)
              } else {
                setDraft(v)
              }
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            // Keep a half-typed tag when leaving the field (e.g. clicking "Save"), without pulling focus back.
            onBlur={() => draft.trim() && add(draft, false)}
            onKeyDown={onKeyDown}
            disabled={full}
            maxLength={MAX_TAG_LENGTH}
            placeholder={full ? `Max. ${MAX_TAGS} tags` : value.length ? 'Add tag…' : 'techno, open-air…'}
            autoComplete="off"
            className="kk-taginput__field"
          />
        </div>
        {open && suggestions.length > 0 && (
          <ul id={listId} role="listbox" className="kk-listbox">
            {suggestions.map((t, i) => (
              <li key={t} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // mousedown would blur the input first and add the half-typed draft
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(t)}
                  data-active={i === active}
                  className="kk-option"
                >
                  {t}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="kk-hint">Press Enter or comma to add. Tags are saved in lowercase.</span>
    </div>
  )
}
