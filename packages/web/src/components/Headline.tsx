// Page headline in Germania One with exactly one chrome word — by default the last one
// ("Events in Berlin", "Halle 4", "Log in").
export function Headline({
  text,
  chrome,
  narrow = false,
  className = '',
  style,
}: {
  text: string
  /** The chrome word; defaults to the last word of `text`. */
  chrome?: string
  narrow?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const trimmed = text.trim()
  const word = chrome ?? trimmed.split(/\s+/).pop() ?? ''
  const at = trimmed.lastIndexOf(word)
  const before = at >= 0 ? trimmed.slice(0, at) : trimmed
  const after = at >= 0 ? trimmed.slice(at + word.length) : ''
  return (
    <h1
      className={`kk-headline${narrow ? ' kk-headline--narrow' : ''} [overflow-wrap:anywhere] ${className}`}
      style={style}
    >
      {before}
      {at >= 0 && <span className="kk-chrome-text">{word}</span>}
      {after}
    </h1>
  )
}
