import { LEGAL_UPDATED } from './operator'

export const lizenz = `
Die Event-Daten von Kellerkompass sind offen. Die Datenbank steht unter der [Open Database License 1.0 (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/), einzelne Inhalte unter der [Database Contents License 1.0 (DbCL)](https://opendatacommons.org/licenses/dbcl/1-0/).

## Was du mit den Daten machen darfst

- **Nutzen und teilen:** auch kommerziell, z. B. in eigenen Apps, Kalendern, Bots oder Websites
- **Verändern und erweitern:** mit eigenen Daten kombinieren oder anders aufbereiten

## Was du dafür tun musst

- **Quelle nennen:** sichtbar und mit Link, z. B. „Event-Daten von [Kellerkompass](https://kellerkompass.de), verfügbar unter der ODbL“
- **Offen halten (Share-Alike):** Veränderst oder erweiterst du die Datenbank und nutzt das Ergebnis öffentlich, musst du diese abgeleitete Datenbank ebenfalls unter der ODbL zugänglich machen. Wer die Daten nur anzeigt, z. B. als Event-Liste auf einer Website, muss lediglich die Quelle nennen.
- **Keine technischen Sperren:** Verbreitest du die Daten mit technischen Schutzmaßnahmen, muss es zusätzlich eine Fassung ohne diese Sperren geben.

## Nicht von der Lizenz erfasst

- der Name und das Logo „Kellerkompass“
- der Quellcode der Website, für den die Lizenz im GitHub-Repository gilt
- Kartendaten und -kacheln, für die gilt: © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright)

## Bedingungen für die API

1. Lesender Zugriff auf öffentliche Event-Daten ist frei. Schreibender Zugriff erfordert einen API-Schlüssel, den Publisher in ihren Kontoeinstellungen anfordern können.
2. Halte die Rate-Limits ein und frage Daten nicht unnötig oft ab.
3. Gib in deinen Anfragen einen aussagekräftigen User-Agent mit Kontaktmöglichkeit an.
4. Die API ist unentgeltlich und ohne Garantie für Verfügbarkeit oder unveränderte Schnittstellen. Größere Änderungen kündigen wir nach Möglichkeit vorher an.
5. Bei Missbrauch können wir API-Schlüssel oder Zugriffe sperren.
6. Für schreibenden Zugriff gelten außerdem die [Nutzungsbedingungen](/nutzungsbedingungen), insbesondere § 5 und § 6.

## Datenschutz für Nachnutzende

Die Daten enthalten Namen von Personen, etwa Künstlerinnen, Künstler und Publisher. Wer sie weiterverarbeitet, ist dafür datenschutzrechtlich selbst verantwortlich. Bitte:

- gleiche deine Kopie regelmäßig ab, damit gelöschte, korrigierte und abgesagte Events auch bei dir verschwinden
- nutze die Daten nicht, um Profile einzelner Personen zu erstellen

Stand: ${LEGAL_UPDATED}
`
