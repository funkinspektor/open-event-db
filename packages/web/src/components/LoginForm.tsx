'use client'

import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const isDev = process.env.NODE_ENV !== 'production'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'limited' | 'error'>('idle')

  if (state === 'sent') {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="mt-2 text-neutral-600">
          If <span className="font-medium text-neutral-900">{email}</span> is registered, a login link is on its
          way. It’s valid for 15 minutes.
        </p>
        {isDev && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Dev mode: no email is sent — the link is printed in the API server log.
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6"
      onSubmit={async (e) => {
        e.preventDefault()
        setState('busy')
        try {
          const res = await fetch(`${API_URL}/api/v1/auth/magic-link`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email }),
          })
          if (res.status === 429) return setState('limited')
          if (!res.ok) return setState('error')
          setState('sent')
        } catch {
          setState('error')
        }
      }}
    >
      <label className="block">
        <span className="text-sm font-medium text-neutral-800">Email</span>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
          placeholder="you@example.com"
        />
      </label>
      {state === 'limited' && (
        <p className="text-sm text-red-600">Too many login requests. Please try again later.</p>
      )}
      {state === 'error' && <p className="text-sm text-red-600">Something went wrong. Please try again.</p>}
      <button
        type="submit"
        disabled={state === 'busy'}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {state === 'busy' ? 'Sending…' : 'Send me a login link'}
      </button>
      <p className="text-xs text-neutral-500">No password needed. We’ll email you a one-time link.</p>
    </form>
  )
}
