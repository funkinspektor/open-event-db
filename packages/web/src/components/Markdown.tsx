import ReactMarkdown, { type Options } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal'
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal'

// Event descriptions are user-written: keep to text formatting, no images or raw HTML
// (react-markdown never renders raw HTML and strips unsafe URLs such as javascript:).
const ALLOWED = ['p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr', 'h1', 'h2', 'h3', 'h4']

// Bare URLs (https://…, www.…) become links, as promoters paste them. Only this part of GFM —
// remark-gfm would also parse tables and footnotes, which descriptions don't render.
type RemarkPlugin = Extract<NonNullable<Options['remarkPlugins']>[number], (...args: never[]) => unknown>

const remarkAutolinkLiteral: RemarkPlugin = function () {
  // Same slots remark-parse reads its syntax extensions from (as remark-gfm does)
  const data = this.data() as { micromarkExtensions?: unknown[]; fromMarkdownExtensions?: unknown[] }
  ;(data.micromarkExtensions ??= []).push(gfmAutolinkLiteral())
  ;(data.fromMarkdownExtensions ??= []).push(gfmAutolinkLiteralFromMarkdown())
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`kk-prose ${className}`}>
      <ReactMarkdown
        // Single line breaks stay line breaks, as promoters type them (and as before Markdown support).
        remarkPlugins={[remarkBreaks, remarkAutolinkLiteral]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          // Page structure owns h1/h2 — description headings start one level lower.
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
