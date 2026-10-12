import Link from 'next/link'

// The Kellerkompass mark: one Germania One K on a holo-chrome squircle.
// Light (default) in the header; `dark` = gunmetal holo with a light K. For favicons see app/icon.svg.
export function LogoMark({ dark = false, label }: { dark?: boolean; label?: string }) {
  return (
    <span
      className={`kk-mark${dark ? ' kk-mark--dark' : ''}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <span className="kk-mark__k" aria-hidden>
        K
      </span>
    </span>
  )
}

export function Logo() {
  return (
    <Link className="kk-logo" href="/">
      <LogoMark />
      Kellerkompass
    </Link>
  )
}
