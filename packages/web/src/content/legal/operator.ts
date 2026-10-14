// Operator details shared by all legal pages. Source of the texts: the "Kellerkompass – Rechtstexte" doc;
// keep both in sync when either changes.
export const OPERATOR_NAME = 'Sebastian Lellinger'
// Ladungsfähige Anschrift (no P.O. box), lines separated by "\n". Must be filled in before going public.
export const OPERATOR_ADDRESS = '[Anschrift]'
export const CONTACT_EMAIL = 'kontakt@kellerkompass.de'
export const LEGAL_UPDATED = 'Oktober 2026'

/** Joins lines with Markdown hard breaks (a trailing backslash; trailing spaces would get trimmed by editors). */
export const lines = (...parts: string[]) => parts.flatMap((p) => p.split('\n')).join('\\\n')
