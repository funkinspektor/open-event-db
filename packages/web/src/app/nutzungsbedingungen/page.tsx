import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'
import { nutzungsbedingungen } from '@/content/legal/nutzungsbedingungen'

export const metadata: Metadata = {
  title: 'Nutzungsbedingungen',
  description: 'Regeln für das Eintragen von Events auf Kellerkompass.',
  alternates: { canonical: '/nutzungsbedingungen' },
}

export default function Page() {
  return <LegalPage title="Nutzungsbedingungen" markdown={nutzungsbedingungen} />
}
