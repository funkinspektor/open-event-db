import { sanitizeLineup, type Lineup } from '@open-event-db/shared'

/** The heading of the first block must say it is a lineup: "Lineup", "Line-up", "Live", "DJs", "Dj Lineup after …". */
const LINEUP_HEAD = /^(dj\s*)?(line-?up|live|djs?)\b/i
const BOLD_HEADING = /^\*\*(.+?)\*\*:?$/
const ITEM = /^\s*[-*]\s+(.+)$/

/** Blocks that often follow a lineup but are not part of it. */
const NOT_LINEUP = /^(tickets?|presale|vvk|vorverkauf|abendkasse|eintritt|preise?|prices?|infos?|einlass|doors?|awareness|hinweise?|notes?|anfahrt|access)\b/i

const isItem = (line: string | undefined) => line !== undefined && ITEM.test(line)
const headingText = (line: string) => {
  const t = line.trim()
  return (t.match(BOLD_HEADING)?.[1] ?? t).replace(/:$/, '').trim()
}
/**
 * A further group once a lineup has started: a bold heading, or a plain line naming a floor ("BLACK (hosted
 * by Jiãla)") but not one like "Info:"; never a heading for tickets, doors and the like.
 */
function isGroupHeading(line: string | undefined): boolean {
  if (line === undefined || isItem(line)) return false
  const t = line.trim()
  if (!t || t.length > 80 || NOT_LINEUP.test(headingText(t))) return false
  return BOLD_HEADING.test(t) || !t.endsWith(':')
}

/**
 * A lineup written into the description as Markdown lists (the flyer import's "**Lineup**" list, or
 * "**Live**" / "**DJs**" groups) → the lineup and the description without it. Null when there is none.
 */
export function splitMarkdownLineup(description: string): { lineup: Lineup; description: string } | null {
  const lines = description.split('\n')
  const start = lines.findIndex((line, i) => {
    const bold = line.trim().match(BOLD_HEADING)
    return !!bold && LINEUP_HEAD.test(bold[1]!.trim()) && isItem(lines[i + 1])
  })
  if (start < 0) return null

  const lineup: Lineup = []
  let at = start
  let end = start
  for (;;) {
    const name = headingText(lines[at]!)
    let next = at + 1
    const acts = []
    while (isItem(lines[next])) {
      acts.push({ name: lines[next]!.match(ITEM)![1]!.trim().slice(0, 200), time: null, live: false, note: null })
      next++
    }
    lineup.push({ name: /^line-?up$/i.test(name) ? null : name.slice(0, 100), acts })
    end = next
    // Another heading with a list right after (blank lines between) belongs to the same lineup
    let after = next
    while (after < lines.length && !lines[after]!.trim()) after++
    if (isGroupHeading(lines[after]) && isItem(lines[after + 1])) at = after
    else break
  }

  const rest = [...lines.slice(0, start), ...lines.slice(end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // Valid as stored: empty items dropped, lengths cut, at most 200 acts
  const clean = sanitizeLineup(lineup)
  return clean.length ? { lineup: clean, description: rest } : null
}
