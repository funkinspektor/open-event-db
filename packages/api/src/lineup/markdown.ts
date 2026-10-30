import { capLineup, type Lineup } from '@open-event-db/shared'

/** The heading of the first block must say it is a lineup: "Lineup", "Line-up", "Live", "DJs", "Dj Lineup after …". */
const LINEUP_HEAD = /^(dj\s*)?(line-?up|live|djs?)\b/i
const BOLD_HEADING = /^\*\*(.+?)\*\*:?$/
const ITEM = /^\s*[-*]\s+(.+)$/

const isItem = (line: string | undefined) => line !== undefined && ITEM.test(line)
/** A plain line can name a floor ("BLACK (hosted by Jiãla)") once a lineup has started. */
const isHeading = (line: string | undefined) => line !== undefined && !!line.trim() && !isItem(line) && line.trim().length <= 80
const headingText = (line: string) => {
  const t = line.trim()
  return (t.match(BOLD_HEADING)?.[1] ?? t).trim()
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
    if (isHeading(lines[after]) && isItem(lines[after + 1])) at = after
    else break
  }

  const rest = [...lines.slice(0, start), ...lines.slice(end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { lineup: capLineup(lineup), description: rest }
}
