import { CONTACT_EMAIL, LEGAL_UPDATED, OPERATOR_ADDRESS, OPERATOR_NAME, lines } from './operator'

export const datenschutz = `
Kellerkompass setzt keine Tracking-Cookies und kein seitenübergreifendes Tracking ein. Alle Server stehen in der EU (Paris und Berlin). Ausnahme sind Kartenkacheln und Ortssuche der OpenStreetMap Foundation im Vereinigten Königreich.

## 1. Verantwortlicher

${lines(OPERATOR_NAME, OPERATOR_ADDRESS, `E-Mail: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`)}

## 2. Hosting und Server-Logs

Kellerkompass läuft bei der Scaleway SAS, 8 rue de la Ville l’Évêque, 75008 Paris, Frankreich, in der Region Paris (fr-par). Scaleway verarbeitet die Daten in unserem Auftrag nach Art. 28 DSGVO.

Bei jedem Aufruf entstehen Server-Logs mit IP-Adresse, Zeitpunkt, aufgerufener Adresse, Referrer, Browser-Kennung und Statuscode. Wir brauchen sie für den sicheren Betrieb und zur Abwehr von Missbrauch. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Die Logs werden nach 7 Tagen gelöscht.

## 3. Events lesen

Event-Seiten und Feed sind ohne Account nutzbar. Dabei verarbeiten wir nur die Daten aus Abschnitt 2, 7 und 8.

## 4. Accounts für Publisher und Scouts

Für einen Account verarbeiten wir deine E-Mail-Adresse, deinen Anzeigenamen, deine Rolle, wer dich eingeladen hat, deine Beiträge mit Änderungshistorie und, falls angefordert, einen API-Schlüssel, den wir nur als Hash speichern. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag). Wir speichern diese Daten, bis du deinen Account löschst.

**Öffentlich sichtbar** sind nur dein Anzeigename an den Events, die du einträgst, und deine Profilseite mit Anzeigename und den Links, die du dort angibst. Deine E-Mail-Adresse wird nie veröffentlicht.

**Login:** Du meldest dich über einen einmal verwendbaren Link mit begrenzter Gültigkeit an, den wir an deine E-Mail-Adresse schicken. Der Link gilt 15 Minuten. Danach setzen wir ein Session-Cookie, das 30 Tage nach deiner letzten Nutzung abläuft. Es ist für den Login technisch notwendig und braucht daher keine Einwilligung (§ 25 Abs. 2 Nr. 2 TDDDG). Weitere Cookies setzen wir nicht.

**Löschung:** Wenn du deinen Account löschst, löschen wir deine Account-Daten. Deine Events bleiben bestehen, die Zuordnung zu dir wird anonymisiert, auch in der Änderungshistorie. In Datenbank-Backups können Daten noch bis zu 7 Tage vorhanden sein.

## 5. E-Mail-Versand

Login-Links verschicken wir über Scaleway Transactional Email (Region Paris). Dabei werden Empfängeradresse, Inhalt und Zustellstatus verarbeitet. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.

## 6. Events aus Bildern erfassen

Publisher und Scouts können Flyer oder Screenshots hochladen, um das Formular vorauszufüllen. Das Bild wird an Scaleway Generative APIs (Region Paris) geschickt, dort ausgewertet und von uns nicht gespeichert. Gespeichert wird nur, was du danach im Formular bestätigst. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Bitte lade nur Bilder hoch, die du dafür verwenden darfst.

## 7. Karten

Event-Seiten binden eine Karte von www.openstreetmap.org ein. Dein Browser lädt die Karte und ihre Kacheln direkt von der OpenStreetMap Foundation, St John’s Innovation Centre, Cowley Road, Cambridge, CB4 0WS, Vereinigtes Königreich. Dabei werden deine IP-Adresse, der Kartenausschnitt und die aufrufende Seite übertragen. Wir haben ein berechtigtes Interesse daran, den Veranstaltungsort direkt anzuzeigen (Art. 6 Abs. 1 lit. f DSGVO). Für das Vereinigte Königreich gilt ein Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO). Mehr dazu in der [Datenschutzerklärung der OpenStreetMap Foundation](https://osmfoundation.org/wiki/Privacy_Policy).

## 8. Ortssuche beim Eintragen

Gibst du beim Anlegen eines Events eine Adresse ein, schickt dein Browser den Suchbegriff und deine IP-Adresse direkt an den Dienst Nominatim der OpenStreetMap Foundation (Anschrift wie oben). Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, die Übermittlung stützt sich auf den Angemessenheitsbeschluss für das Vereinigte Königreich.

## 9. Kontakt per E-Mail

Schreibst du uns, verarbeiten wir deine Nachricht und Adresse, um zu antworten (Art. 6 Abs. 1 lit. f DSGVO). Das Postfach liegt bei der Heinlein Hosting GmbH (mailbox.org), Schwedter Straße 8/9A, 10119 Berlin, die es in unserem Auftrag nach Art. 28 DSGVO betreibt. Wir löschen die Nachricht, wenn sie erledigt ist und keine Aufbewahrungspflicht besteht.

## 10. Meldungen von Inhalten

Meldest du einen Inhalt, verarbeiten wir die Meldung, deine Kontaktdaten und unsere Entscheidung. Rechtsgrundlage sind Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit Art. 16 und 17 DSA sowie Art. 6 Abs. 1 lit. f DSGVO. Wir löschen die Unterlagen 12 Monate nach Abschluss des Falls.

## 11. Daten über Dritte in Events

Events enthalten oft Namen von Künstlerinnen und Künstlern, DJs, Kollektiven und Veranstaltenden. Diese Angaben stammen von Publishern, Scouts oder aus öffentlichen Ankündigungen wie Flyern und Event-Seiten. Wir veröffentlichen sie, um über öffentliche Kulturveranstaltungen zu informieren (Art. 6 Abs. 1 lit. f DSGVO). Wer genannt ist und das nicht möchte, kann jederzeit widersprechen, siehe Abschnitt 13.

## 12. Offene Daten und API

Event-Daten einschließlich Anzeigenamen und genannter Personen stehen über Website und API unter der Open Database License (ODbL) zur Verfügung. Andere dürfen sie weiterverwenden und sind dafür selbst verantwortlich. Was wir löschen, verschwindet aus unserer Datenbank und der API. Bereits erstellte Kopien Dritter können wir nicht zurückholen.

## 13. Deine Rechte

Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20 DSGVO). Schreib dazu an [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).

**Widerspruchsrecht:** Verarbeiten wir Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO, kannst du aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit widersprechen (Art. 21 DSGVO).

Du kannst dich außerdem bei einer Aufsichtsbehörde beschweren. Zuständig für uns ist die Berliner Beauftragte für Datenschutz und Informationsfreiheit, Alt-Moabit 59–61, 10555 Berlin.

## 14. Stand

${LEGAL_UPDATED}
`
