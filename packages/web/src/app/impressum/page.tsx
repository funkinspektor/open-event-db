import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'
import { impressum } from '@/content/legal/impressum'

export const metadata: Metadata = {
  title: 'Impressum',
  description: 'Impressum und Kontakt von Kellerkompass.',
  alternates: { canonical: '/impressum' },
}

export default function Page() {
  return <LegalPage title="Impressum" markdown={impressum} />
}
