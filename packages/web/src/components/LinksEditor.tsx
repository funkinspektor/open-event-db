'use client'

import { useId } from 'react'

export type LinkRow = { key: string; url: string }

export const toLinkRows = (links: Record<string, string> | undefined): LinkRow[] =>
  Object.entries(links ?? {}).map(([key, url]) => ({ key, url }))

export const fromLinkRows = (rows: LinkRow[]): Record<string, string> =>
  Object.fromEntries(rows.filter((l) => l.key && l.url).map((l) => [l.key.trim(), l.url.trim()]))

interface Props {
  rows: LinkRow[]
  onChange: (rows: LinkRow[]) => void
  suggestedKeys: string[]
}

export function LinksEditor({ rows, onChange, suggestedKeys }: Props) {
  const listId = useId()

  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="kk-linkrow">
          <input
            list={listId}
            value={row.key}
            onChange={(e) => onChange(rows.map((l, j) => (j === i ? { ...l, key: e.target.value } : l)))}
            placeholder="type"
            aria-label="Link type"
            className="kk-input"
          />
          <input
            type="url"
            value={row.url}
            onChange={(e) => onChange(rows.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))}
            placeholder="https://…"
            aria-label="URL"
            className="kk-input"
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="kk-iconbtn"
            aria-label="Remove link"
          >
            ×
          </button>
        </div>
      ))}
      <datalist id={listId}>
        {suggestedKeys.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => onChange([...rows, { key: '', url: '' }])}
        className="kk-btn kk-btn--text self-start py-2"
      >
        + Add link
      </button>
    </>
  )
}
