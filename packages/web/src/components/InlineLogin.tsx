'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { LoginForm } from './LoginForm'

/**
 * Bottom sheet with the login form, opened by the interest toggle for logged-out visitors. The magic link
 * brings them to `returnTo`, where the interest is saved (see InterestFromLogin).
 */
export function InlineLogin({ returnTo, onClose }: { returnTo: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      root.style.overflow = overflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <>
      <div className="kk-scrim" onClick={onClose} />
      <div
        ref={ref}
        className="kk-sheet kk-sheet--login"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kk-login-title"
        tabIndex={-1}
      >
        <span className="kk-sheet__grip" aria-hidden />
        <div className="kk-sheet__head">
          <h2 id="kk-login-title" className="kk-sheet__title">
            Log in to save events
          </h2>
          <button type="button" className="kk-btn kk-btn--text" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="m-0 text-muted">Keep events in My events and in your calendar. Free, no password.</p>
        <div className="pb-6">
          <LoginForm returnTo={returnTo} />
        </div>
      </div>
    </>,
    document.body,
  )
}
