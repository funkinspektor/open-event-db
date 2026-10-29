import type { DefaultTreeAdapterTypes } from 'parse5'
import { berlinInstant, berlinIso, fmtDay, type CalendarDay } from '../../extract/normalize.js'
import type { FeedMoment } from './ical.js'

/** Helpers shared by the adapters that read a venue's HTML programme page with parse5. */

export type Node = DefaultTreeAdapterTypes.Node
export type Element = DefaultTreeAdapterTypes.Element

export const isElement = (node: Node): node is Element => 'tagName' in node
export const hasClass = (el: Element, name: string) =>
  el.attrs.some((a) => a.name === 'class' && a.value.split(/\s+/).includes(name))
export const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)?.value ?? null
export const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

export function* elements(node: Node): Generator<Element> {
  if (isElement(node)) yield node
  if ('childNodes' in node) for (const child of node.childNodes) yield* elements(child)
}

/** Text with <br> as "\n". Comments are separate nodes, so commented-out markup never shows up here. */
export function textOf(node: Node): string {
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterTypes.TextNode).value
  if (isElement(node) && node.tagName === 'br') return '\n'
  if ('childNodes' in node) return node.childNodes.map(textOf).join('')
  return ''
}

const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'tr'])

/**
 * An absolute http(s) link without click tracking; null for placeholders such as "https://". Text copied
 * from Facebook wraps links in its l.facebook.com redirect, which is unwrapped to the target.
 */
export function webUrl(href: string | null): string | null {
  if (!href) return null
  try {
    let url = new URL(href)
    const target = url.hostname === 'l.facebook.com' ? url.searchParams.get('u') : null
    if (target) url = new URL(target)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.')) return null
    for (const key of [...url.searchParams.keys()]) {
      if (key === 'fbclid' || key.startsWith('utm_')) url.searchParams.delete(key)
    }
    return url.href
  } catch {
    return null
  }
}

/** The editor's HTML as Markdown-ish text: blocks become paragraphs, <br> line breaks, links stay links. */
export function richText(root: Node): string {
  const out: string[] = []
  const walk = (node: Node) => {
    if (node.nodeName === '#text') {
      out.push(textOf(node).replace(/\s+/g, ' '))
      return
    }
    if (!isElement(node)) return
    if (node.tagName === 'br') {
      out.push('\n')
      return
    }
    if (node.tagName === 'a') {
      const text = squash(textOf(node))
      const href = webUrl(attr(node, 'href'))
      if (href && text && text !== href) {
        out.push(`[${text.replace(/[[\]]/g, '\\$&')}](${href.replaceAll('(', '%28').replaceAll(')', '%29')})`)
      } else out.push(text || href || '')
      return
    }
    const block = BLOCKS.has(node.tagName)
    if (block) out.push('\n\n')
    node.childNodes.forEach(walk)
    if (block) out.push('\n\n')
  }
  walk(root)
  return out
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A Berlin day and minutes after midnight (null: no time) as a feed moment. */
export function berlinMoment(day: CalendarDay, minutes: number | null): FeedMoment {
  return {
    date: fmtDay(day),
    time: minutes === null ? null : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
    iso: berlinIso(berlinInstant(day, minutes ?? 0)),
  }
}
