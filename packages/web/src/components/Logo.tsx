import Link from 'next/link'

const NEEDLE = (
  <>
    <path d="M47 49H82" />
    <path d="M71 40.75Q76.5 42.175 82 49Q76.5 55.825 71 57.25" />
  </>
)

// The Kellerkompass mark: UV Fraktur K + compass needle over an offset ice K.
// `bare` drops the dark-chrome squircle (header form). For favicons see app/icon.svg.
export function LogoMark({ bare = false, label }: { bare?: boolean; label?: string }) {
  return (
    <span
      className={`kk-mark${bare ? ' kk-mark--bare' : ''}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <span className="kk-mark__inner" aria-hidden>
        <span className="kk-mark__k kk-mark__k--back">K</span>
        <svg className="kk-mark__needle kk-mark__needle--back" viewBox="0 0 100 100">
          {NEEDLE}
        </svg>
        <span className="kk-mark__k">K</span>
        <svg className="kk-mark__needle" viewBox="0 0 100 100">
          {NEEDLE}
        </svg>
      </span>
    </span>
  )
}

export function Logo() {
  return (
    <Link className="kk-logo" href="/">
      <LogoMark bare />
      Kellerkompass
    </Link>
  )
}
