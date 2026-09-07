'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      className={className}
      onClick={async () => {
        setBusy(true)
        try {
          await fetch(`${API_URL}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' })
        } finally {
          router.push('/')
          router.refresh()
        }
      }}
    >
      {busy ? 'Logging out…' : 'Log out'}
    </button>
  )
}
