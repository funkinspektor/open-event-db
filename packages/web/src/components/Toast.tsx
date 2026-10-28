'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * One-shot confirmation after a redirect (e.g. `?saved=created`). Removes the query parameter
 * right away so a reload or shared link doesn't show it again, and fades out after a few seconds.
 * Without `param` it is shown as-is (mount it conditionally, with a `key` per message); an optional
 * `action` adds a link and keeps the toast around a little longer.
 */
export function Toast({
  message,
  param,
  action,
}: {
  message: string
  param?: string
  action?: { href: string; label: string }
}) {
  const [visible, setVisible] = useState(true)
  const hasAction = Boolean(action)

  useEffect(() => {
    if (param) {
      const url = new URL(window.location.href)
      url.searchParams.delete(param)
      window.history.replaceState(window.history.state, '', url)
    }
    const timer = setTimeout(() => setVisible(false), hasAction ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [param, hasAction])

  if (!visible) return null
  return (
    <div className="kk-toast" role="status">
      <span className="kk-toast__dot" aria-hidden />
      {message}
      {action && (
        <Link href={action.href} className="font-bold underline underline-offset-4">
          {action.label}
        </Link>
      )}
      <button type="button" onClick={() => setVisible(false)} className="kk-tag__remove" aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
