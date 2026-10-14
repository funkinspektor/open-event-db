// Operator details shared by all legal pages. Source of the texts: the "Kellerkompass – Rechtstexte" doc;
// keep both in sync when either changes.
export const OPERATOR_NAME = 'Sebastian Lellinger'
// Ladungsfähige Anschrift (no P.O. box), lines separated by "\n". Empty until it's filled in: the pages then
// show name and email only.
export const OPERATOR_ADDRESS = ''
export const CONTACT_EMAIL = 'kontakt@kellerkompass.de'
export const LEGAL_UPDATED = 'Oktober 2026'

/** Joins lines with Markdown hard breaks (a trailing backslash; trailing spaces would get trimmed by editors). */
export const lines = (...parts: string[]) =>
  parts
    .flatMap((p) => p.split('\n'))
    .filter((l) => l.trim())
    .join('\\\n')
