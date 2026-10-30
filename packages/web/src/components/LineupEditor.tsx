'use client'

import { useId, useState } from 'react'
import { emptyRow, parseLineupText, type LineupGroupRow, type LineupRow } from '@/lib/lineup'

interface Props {
  value: LineupGroupRow[]
  onChange: (groups: LineupGroupRow[]) => void
}

/** Lineup groups (floors, "Live" / "DJs") with their acts, in the order the event page shows them. */
export function LineupEditor({ value: groups, onChange }: Props) {
  const labelId = useId()
  const pasteId = useId()
  const [pasting, setPasting] = useState(false)
  const [paste, setPaste] = useState('')

  const setGroup = (gi: number, group: LineupGroupRow) => onChange(groups.map((g, i) => (i === gi ? group : g)))
  const setAct = (gi: number, ai: number, act: Partial<LineupRow>) =>
    setGroup(gi, { ...groups[gi]!, acts: groups[gi]!.acts.map((a, i) => (i === ai ? { ...a, ...act } : a)) })
  const removeAct = (gi: number, ai: number) => {
    const acts = groups[gi]!.acts.filter((_, i) => i !== ai)
    onChange(acts.length ? groups.map((g, i) => (i === gi ? { ...g, acts } : g)) : groups.filter((_, i) => i !== gi))
  }

  function addPasted() {
    onChange([...groups, ...parseLineupText(paste)])
    setPaste('')
    setPasting(false)
  }

  return (
    <div className="kk-field">
      <div className="flex items-end justify-between gap-3">
        <span id={labelId}>
          Lineup <span className="kk-field__opt">(optional)</span>
        </span>
        <button type="button" aria-pressed={pasting} onClick={() => setPasting(!pasting)} className="kk-tag">
          Paste list
        </button>
      </div>

      {pasting && (
        <div className="kk-lineup-paste">
          <label htmlFor={pasteId} className="kk-hint">
            One act per line. “22:00 Name (Live) – Label” is understood; a line ending in “:” starts a group.
          </label>
          <textarea
            id={pasteId}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            placeholder={'Panorama Bar:\n22:00 Courtney Bailey b2b Hitomi – second circle\n04:30 Z@P (Live) – Cartulis Music'}
            className="kk-input"
          />
          <div className="flex items-center gap-3">
            <button type="button" onClick={addPasted} disabled={!paste.trim()} className="kk-btn kk-btn--secondary">
              Add to lineup
            </button>
            <span className="kk-hint">Adds below what is there.</span>
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-col gap-3" role="group" aria-labelledby={labelId}>
          {groups.map((group, gi) => (
            <div key={gi} className="kk-lineup-group">
              {(groups.length > 1 || group.name) && (
                <div className="flex items-center gap-2">
                  <input
                    value={group.name}
                    onChange={(e) => setGroup(gi, { ...group, name: e.target.value })}
                    placeholder="Floor or group, e.g. Panorama Bar, Live, DJs"
                    aria-label="Group name"
                    className="kk-input kk-lineup-group__name"
                  />
                  <button
                    type="button"
                    onClick={() => onChange(groups.filter((_, i) => i !== gi))}
                    className="kk-iconbtn"
                    aria-label="Remove group"
                  >
                    ×
                  </button>
                </div>
              )}
              {group.acts.map((act, ai) => (
                <div key={ai} className="kk-lineup-row">
                  <input
                    value={act.time}
                    onChange={(e) => setAct(gi, ai, { time: e.target.value })}
                    placeholder="Time"
                    inputMode="numeric"
                    pattern="([01]\d|2[0-3]):[0-5]\d"
                    title="HH:MM, e.g. 23:30"
                    aria-label="Set time (optional)"
                    className="kk-input kk-lineup-row__time"
                  />
                  <input
                    value={act.name}
                    onChange={(e) => setAct(gi, ai, { name: e.target.value })}
                    placeholder="Artist, DJ or act"
                    aria-label="Act"
                    className="kk-input"
                  />
                  <button
                    type="button"
                    aria-pressed={act.live}
                    onClick={() => setAct(gi, ai, { live: !act.live })}
                    className="kk-tag kk-lineup-row__live"
                  >
                    Live
                  </button>
                  <input
                    value={act.note}
                    onChange={(e) => setAct(gi, ai, { note: e.target.value })}
                    placeholder="Label, crew, country"
                    aria-label="Note (optional)"
                    className="kk-input kk-lineup-row__note"
                  />
                  <button type="button" onClick={() => removeAct(gi, ai)} className="kk-iconbtn" aria-label="Remove act">
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setGroup(gi, { ...group, acts: [...group.acts, emptyRow()] })}
                className="kk-btn kk-btn--text self-start py-2"
              >
                + Add act
              </button>
            </div>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <button
          type="button"
          onClick={() => onChange([{ name: '', acts: [emptyRow()] }])}
          className="kk-btn kk-btn--text self-start py-2"
        >
          + Add act
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onChange([...groups, { name: '', acts: [emptyRow()] }])}
          className="kk-btn kk-btn--text self-start py-2"
        >
          + Add group (floor, room, Live / DJs)
        </button>
      )}
      <span className="kk-hint">Shown as its own section on the event page, in this order. Time and note are optional.</span>
    </div>
  )
}
