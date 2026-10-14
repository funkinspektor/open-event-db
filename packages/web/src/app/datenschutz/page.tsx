import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'
import { datenschutz } from '@/content/legal/datenschutz'

export const metadata: Metadata = {
  title: 'Datenschutz',
  description: 'Wie Kellerkompass mit deinen Daten umgeht.',
  alternates: { canonical: '/datenschutz' },
}

export default function Page() {
  return <LegalPage title="Datenschutz" markdown={datenschutz} />
}
