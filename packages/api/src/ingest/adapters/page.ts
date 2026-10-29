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

const pad = (n: number) => String(n).padStart(2, '0')

/** A Berlin day and minutes after midnight (null: no time) as a feed moment. */
export function berlinMoment(day: CalendarDay, minutes: number | null): FeedMoment {
  return {
    date: fmtDay(day),
    time: minutes === null ? null : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
    iso: berlinIso(berlinInstant(day, minutes ?? 0)),
  }
}
