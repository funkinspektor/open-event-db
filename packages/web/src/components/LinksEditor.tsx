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
  inputClassName: string
}

export function LinksEditor({ rows, onChange, suggestedKeys, inputClassName }: Props) {
  const listId = useId()

  return (
    <div className="mt-1 space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <input
            list={listId}
            value={row.key}
            onChange={(e) => onChange(rows.map((l, j) => (j === i ? { ...l, key: e.target.value } : l)))}
            placeholder="type"
            className={`${inputClassName} mt-0 shrink-0 basis-28 sm:basis-36`}
          />
          <input
            type="url"
            value={row.url}
            onChange={(e) => onChange(rows.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))}
            placeholder="https://…"
            className={`${inputClassName} mt-0 min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="rounded-md border border-neutral-300 px-2 text-sm text-neutral-600 hover:bg-neutral-50"
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
        className="text-sm text-neutral-700 underline-offset-2 hover:underline"
      >
        + Add link
      </button>
    </div>
  )
}
