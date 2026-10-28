// The system's stroke icons (24×24, round caps). Arrows: ↗ leaves Kellerkompass,
// → enters an item, ← goes back. Never typed as glyphs.

export function ExtIcon() {
  return (
    <svg className="kk-icon kk-icon--ext" viewBox="0 0 24 24" aria-hidden>
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  )
}

export function NextIcon({ className = 'kk-icon kk-icon--next' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 12h12" />
      <path d="M13.5 7.5L18 12l-4.5 4.5" />
    </svg>
  )
}

export function BackIcon() {
  return (
    <svg className="kk-icon kk-icon--back" viewBox="0 0 24 24" aria-hidden>
      <path d="M18 12H6" />
      <path d="M10.5 7.5L6 12l4.5 4.5" />
    </svg>
  )
}

export function ChevronIcon({ className = 'kk-icon', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function TickIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="kk-icon" viewBox="0 0 24 24" style={{ width: size, height: size, strokeWidth: 3 }} aria-hidden>
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg className="kk-icon kk-icon--btn" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function FilterIcon() {
  return (
    <svg className="kk-icon kk-icon--btn" viewBox="0 0 24 24" aria-hidden>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg className="kk-icon h-[18px] w-[18px] text-muted" style={{ strokeWidth: 2 }} viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  )
}
