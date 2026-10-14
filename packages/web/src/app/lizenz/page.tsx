import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'
import { lizenz } from '@/content/legal/lizenz'

export const metadata: Metadata = {
  title: 'Datenlizenz und API',
  description: 'Unter welcher Lizenz die Event-Daten von Kellerkompass stehen.',
  alternates: { canonical: '/lizenz' },
}

export default function Page() {
  return <LegalPage title="Datenlizenz und API" markdown={lizenz} />
}
