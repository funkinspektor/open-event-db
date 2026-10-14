import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { Headline } from './Headline'

// Legal texts are our own, German, and link between each other: unlike event descriptions they keep
// their h2 sections, and internal links stay in the tab.
export function LegalPage({ title, markdown }: { title: string; markdown: string }) {
  return (
    <div className="kk-container kk-container--narrow" lang="de">
      <section className="kk-intro" style={{ gap: 14 }}>
        <p className="kk-eyebrow">Rechtliches</p>
        <Headline text={title} narrow />
      </section>
      <div className="kk-prose kk-legal text-body-long text-ink-soft">
        <ReactMarkdown
          components={{
            a: ({ href = '', children }) =>
              href.startsWith('/') ? (
                <Link href={href}>{children}</Link>
              ) : (
                <a href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer">
                  {children}
                </a>
              ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  )
}
