'use client'

import { useEffect, useState } from 'react'

/**
 * One-shot confirmation after a redirect (e.g. `?saved=created`). Removes the query parameter
 * right away so a reload or shared link doesn't show it again, and fades out after a few seconds.
 */
export function Toast({ message, param }: { message: string; param: string }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete(param)
    window.history.replaceState(window.history.state, '', url)
    const timer = setTimeout(() => setVisible(false), 4000)
    return () => clearTimeout(timer)
  }, [param])

  if (!visible) return null
  return (
    <div className="kk-toast" role="status">
      <span className="kk-toast__dot" aria-hidden />
      {message}
      <button type="button" onClick={() => setVisible(false)} className="kk-tag__remove" aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
