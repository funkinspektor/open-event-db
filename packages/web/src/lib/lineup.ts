import type { Lineup } from '@open-event-db/shared'

/** One act as the form edits it: empty strings for what is not filled in. */
export type LineupRow = { time: string; name: string; live: boolean; note: string }
export type LineupGroupRow = { name: string; acts: LineupRow[] }

export const emptyRow = (): LineupRow => ({ time: '', name: '', live: false, note: '' })

export const toLineupRows = (lineup: Lineup): LineupGroupRow[] =>
  lineup.map((g) => ({
    name: g.name ?? '',
    acts: g.acts.map((a) => ({ time: a.time ?? '', name: a.name, live: a.live, note: a.note ?? '' })),
  }))

/** What the API stores: acts without a name and groups left without acts are dropped. */
export function fromLineupRows(groups: LineupGroupRow[]): Lineup {
  return groups
    .map((g) => ({
      name: g.name.trim() || null,
      acts: g.acts
        .filter((a) => a.name.trim())
        .map((a) => ({ name: a.name.trim(), time: a.time.trim() || null, live: a.live, note: a.note.trim() || null })),
    }))
    .filter((g) => g.acts.length > 0)
}

// "04.30 Z@P (Live) – Cartulis Music": time, name, live mark, note after a spaced dash
const ACT = /^(?:(\d{1,2})[:.](\d{2})\s+)?(.+?)(\s*\(live\))?(?:\s+[–-]\s+(.+))?$/i

/** A pasted list, one act per line; a line ending in ":" starts a group. */
export function parseLineupText(text: string): LineupGroupRow[] {
  const groups: LineupGroupRow[] = []
  let current: LineupGroupRow | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.endsWith(':')) {
      current = { name: line.slice(0, -1).trim(), acts: [] }
      groups.push(current)
      continue
    }
    const m = line.match(ACT)!
    if (!current) {
      current = { name: '', acts: [] }
      groups.push(current)
    }
    current.acts.push({
      time: m[1] ? `${m[1].padStart(2, '0')}:${m[2]}` : '',
      name: m[3]!.trim(),
      live: !!m[4],
      note: m[5]?.trim() ?? '',
    })
  }
  return groups.filter((g) => g.acts.length > 0)
}
