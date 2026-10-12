import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

/**
 * Markdown → plain text for places that can't show formatting (Schema.org description).
 * Keeps the words (link text, image alt), drops syntax and raw HTML, one line per block.
 */
export function markdownToPlainText(markdown: string): string {
  return toText(fromMarkdown(markdown))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function toText(node: Nodes): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'code':
      return node.value
    case 'break':
      return '\n'
    case 'image':
      return node.alt ?? ''
    case 'html':
    case 'definition':
    case 'thematicBreak':
      return ''
  }
  if (!('children' in node)) return ''
  const inline = node.type === 'paragraph' || node.type === 'heading' || node.type === 'emphasis' ||
    node.type === 'strong' || node.type === 'delete' || node.type === 'link' || node.type === 'linkReference'
  return (node.children as Nodes[]).map(toText).join(inline ? '' : '\n')
}
