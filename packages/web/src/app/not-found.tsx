import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-sm font-medium text-violet-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-neutral-600">We couldn’t find what you were looking for.</p>
      <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-2">
        Back to events
      </Link>
    </div>
  )
}
