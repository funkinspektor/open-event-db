import { CONTACT_EMAIL, OPERATOR_ADDRESS, OPERATOR_NAME, lines } from './operator'

export const impressum = `
## Angaben gemäß § 5 DDG und § 18 Abs. 1 MStV

${lines(OPERATOR_NAME, OPERATOR_ADDRESS)}

## Kontakt

E-Mail: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})

## Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV

${OPERATOR_ADDRESS ? `${OPERATOR_NAME}, Anschrift wie oben` : OPERATOR_NAME}

## Zentrale Kontaktstelle nach Art. 11 und 12 Digital Services Act (DSA)

Behörden der Mitgliedstaaten, die EU-Kommission, das Europäische Gremium für digitale Dienste sowie Nutzerinnen und Nutzer erreichen uns unter [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). Wir kommunizieren auf Deutsch und Englisch.

## Inhalte von Nutzerinnen und Nutzern

Events auf Kellerkompass werden von Publishern und Scouts eingetragen. Rechtswidrige Inhalte kannst du über den Link „Report event“ auf jeder Event-Seite oder per E-Mail an [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) melden. Wie wir mit Meldungen umgehen, steht in den [Nutzungsbedingungen](/nutzungsbedingungen).
`
