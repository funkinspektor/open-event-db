/** The inbox line for a suggestion: who sent it and how their earlier suggestions went. */
export function submitterLine(s: { display_name: string; handle: string; accepted: number; decided: number }): string {
  const record = s.decided === 0 ? 'first suggestion' : `${s.accepted} of ${s.decided} accepted`
  return `Suggested by ${s.display_name} (@${s.handle}) · ${record}`
}
