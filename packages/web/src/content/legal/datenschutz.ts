import { CONTACT_EMAIL, LEGAL_UPDATED, OPERATOR_ADDRESS, OPERATOR_NAME, lines } from './operator'

export const datenschutz = `
Kellerkompass setzt keine Tracking-Cookies und kein seitenübergreifendes Tracking ein. Alle Server stehen in der EU (Amsterdam, Paris und Berlin). Ausnahme sind Kartenkacheln und Ortssuche der OpenStreetMap Foundation im Vereinigten Königreich.

## 1. Verantwortlicher

${lines(OPERATOR_NAME, OPERATOR_ADDRESS, `E-Mail: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`)}

## 2. Hosting und Server-Logs

Kellerkompass läuft bei der Scaleway SAS, 8 rue de la Ville l’Évêque, 75008 Paris, Frankreich, in der Region Amsterdam (nl-ams), Niederlande. Scaleway verarbeitet die Daten in unserem Auftrag nach Art. 28 DSGVO.

Bei jedem Aufruf entstehen Server-Logs mit IP-Adresse, Zeitpunkt, aufgerufener Adresse, Referrer, Browser-Kennung und Statuscode. Wir brauchen sie für den sicheren Betrieb und zur Abwehr von Missbrauch. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Die Logs werden nach 7 Tagen gelöscht.

## 3. Events lesen

Event-Seiten und Feed sind ohne Account nutzbar. Dabei verarbeiten wir nur die Daten aus Abschnitt 2, 7 und 8.

## 4. Accounts und Organizer-Profile

Accounts sind für Personen und für alle offen: Man meldet sich mit seiner E-Mail-Adresse an und legt beim ersten Login einen Account an. Organizer-Profile sind öffentliche Profile von Veranstalter:innen, etwa Kollektiven, Reihen oder Venues, die von ihren Mitgliedern (Accounts) verwaltet werden.

Für einen Account verarbeiten wir deine E-Mail-Adresse, deinen Anzeigenamen, deinen Handle, den Zeitpunkt deiner Zustimmung zu den Nutzungsbedingungen und den Abschluss der Einrichtung, deine Sessions, deine Rolle, deine Beiträge mit Änderungshistorie und, falls angefordert, einen API-Schlüssel, den wir nur als Hash speichern. Rechtsgrundlage für die Account-Funktionen ist Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag). Wir speichern diese Daten, bis du deinen Account löschst.

**Öffentlich sichtbar** sind nur dein Anzeigename an den Events, die du einträgst, und deine Profilseite mit Anzeigename und den Links, die du dort angibst. Deine E-Mail-Adresse wird nie veröffentlicht.

**Login:** Du meldest dich über einen einmal verwendbaren Link mit begrenzter Gültigkeit an, den wir an deine E-Mail-Adresse schicken. Der Link gilt 15 Minuten. Fordert jemand mit einer noch unbekannten Adresse einen Link an, speichern wir die Anfrage bis zu 24 Stunden zusammen mit der IP-Adresse, um pro IP-Adresse nur eine begrenzte Zahl an Anmelde-Mails zu verschicken und Missbrauch zu verhindern (Art. 6 Abs. 1 lit. f DSGVO, berechtigtes Interesse an der Missbrauchsabwehr). Danach setzen wir ein Session-Cookie, das 30 Tage nach deiner letzten Nutzung abläuft. Es ist für den Login technisch notwendig und braucht daher keine Einwilligung (§ 25 Abs. 2 Nr. 2 TDDDG). Weitere Cookies setzen wir nicht.

**E-Mail-Adresse ändern:** Der Bestätigungslink an die neue Adresse gilt 24 Stunden. Erst nach der Bestätigung ersetzt die neue Adresse die alte.

**Löschung:** Du kannst deinen Account jederzeit selbst in deinem Profil löschen. Dann löschen wir deine Account-Daten, deine Sessions, deine gemerkten Events und deinen Kalender-Link. Events, die du eingetragen hast, bleiben bestehen und werden danach als „Deleted account“ angezeigt, auch in der Änderungshistorie. In Datenbank-Backups können Daten noch bis zu 7 Tage vorhanden sein.

## 4a. Gemerkte Events und Kalender-Link

Mit einem Account kannst du Events als „Interessiert“ markieren. Wir speichern dafür, welcher Account welches Event markiert hat und wann. Die Markierungen sind nur für dich sichtbar und werden nicht veröffentlicht. Intern werten wir nur Summen pro Event aus, nicht einzelne Personen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung der Funktion).

Aus deinen Markierungen kannst du einen privaten Kalender-Link erzeugen. Er enthält ein geheimes Token: Wer den Link kennt, sieht deine gemerkten Events. Gib ihn deshalb nicht weiter. Du kannst ihn jederzeit neu erzeugen, der alte Link funktioniert dann nicht mehr. Markierungen und Kalender-Link speichern wir, bis du sie entfernst oder deinen Account löschst.

## 4b. Event-Vorschläge

Mit einem Account kannst du Events vorschlagen. Wir speichern dafür den Inhalt deines Vorschlags (Angaben zum Event, optional ein Bild), welcher Account ihn eingereicht hat, den Zeitpunkt und den Status. Lehnt das Kellerkompass-Team deinen Vorschlag ab, speichern wir optional eine kurze Begründung, die du unter „Meine Vorschläge“ siehst. Das Kellerkompass-Team sieht deinen Anzeigenamen und deinen Handle zum Vorschlag, deine E-Mail-Adresse sieht es dort nicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung der Funktion).

**Automatische Vorab-Einschätzung:** Den Inhalt deines Vorschlags (Titel, Beschreibung, Ort, Zeitpunkt, Kategorien und Line-up, keine Account-Daten) schicken wir an Scaleway Generative APIs (Region Paris). Dort entsteht eine automatische Vorab-Einschätzung, ob das Event zu Kellerkompass passt. Sie hilft dem Kellerkompass-Team nur beim Sortieren und entscheidet nichts.

**Bilder:** Ziehst du einen Vorschlag zurück, löschen wir das Bild sofort. Das Bild eines abgelehnten Vorschlags löschen wir nach 30 Tagen, ebenso das Bild eines angenommenen Vorschlags, falls die Kopie zum Event nicht geklappt hat. Wird ein Vorschlag angenommen, kopieren wir das Bild zum Event. Es wird dann Teil des öffentlichen Events und mit ihm veröffentlicht, auch über die offene API (Abschnitt 12).

**Veröffentlichung:** Nimmt das Kellerkompass-Team deinen Vorschlag an, geht das Event online und dein Anzeigename steht öffentlich als „Added by“ am Event. Bis dahin ist dein Vorschlag nicht öffentlich. Über die Veröffentlichung informieren wir dich per E-Mail (Abschnitt 5).

**Speicherdauer:** Den Vorschlag selbst (Inhalt, wer ihn eingereicht hat, Begründung) speichern wir auch nach der Entscheidung, als Protokoll und zur Erkennung doppelter Vorschläge. Löschst du deinen Account, ziehen wir noch offene Vorschläge zurück und löschen ihre Bilder innerhalb einer Stunde. Deine Vorschläge bleiben danach gespeichert, aber ohne Bezug zu deiner Person, weil wir den Account anonymisieren. Pro Account sind nur wenige Vorschläge pro Tag möglich (derzeit 5), um Missbrauch zu verhindern.

## 5. E-Mail-Versand

Login-, Anmelde- und Bestätigungslinks sowie die Nachricht, dass dein Vorschlag online ist, verschicken wir über Scaleway Transactional Email (Region Paris). Dabei werden Empfängeradresse, Inhalt und Zustellstatus verarbeitet. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.

## 6. Events aus Bildern erfassen

Jeder Account, der die Einrichtung abgeschlossen hat, kann Flyer oder Screenshots hochladen, um das Formular vorauszufüllen. Das Bild wird an Scaleway Generative APIs (Region Paris) geschickt, dort ausgewertet und von uns nicht gespeichert. Gespeichert wird nur, was du danach im Formular bestätigst. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Bitte lade nur Bilder hoch, die du dafür verwenden darfst.

## 7. Karten

Event-Seiten binden eine Karte von www.openstreetmap.org ein. Dein Browser lädt die Karte und ihre Kacheln direkt von der OpenStreetMap Foundation, St John’s Innovation Centre, Cowley Road, Cambridge, CB4 0WS, Vereinigtes Königreich. Dabei werden deine IP-Adresse, der Kartenausschnitt und die aufrufende Seite übertragen. Wir haben ein berechtigtes Interesse daran, den Veranstaltungsort direkt anzuzeigen (Art. 6 Abs. 1 lit. f DSGVO). Für das Vereinigte Königreich gilt ein Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO). Mehr dazu in der [Datenschutzerklärung der OpenStreetMap Foundation](https://osmfoundation.org/wiki/Privacy_Policy).

## 8. Ortssuche beim Eintragen

Gibst du beim Anlegen eines Events eine Adresse ein, schickt dein Browser den Suchbegriff und deine IP-Adresse direkt an den Dienst Nominatim der OpenStreetMap Foundation (Anschrift wie oben). Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO, die Übermittlung stützt sich auf den Angemessenheitsbeschluss für das Vereinigte Königreich.

## 9. Kontakt per E-Mail

Schreibst du uns, verarbeiten wir deine Nachricht und Adresse, um zu antworten (Art. 6 Abs. 1 lit. f DSGVO). Das Postfach liegt bei der Heinlein Hosting GmbH (mailbox.org), Schwedter Straße 8/9A, 10119 Berlin, die es in unserem Auftrag nach Art. 28 DSGVO betreibt. Wir löschen die Nachricht, wenn sie erledigt ist und keine Aufbewahrungspflicht besteht.

## 10. Meldungen von Inhalten

Meldest du einen Inhalt, verarbeiten wir die Meldung, deine Kontaktdaten und unsere Entscheidung. Rechtsgrundlage sind Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit Art. 16 und 17 DSA sowie Art. 6 Abs. 1 lit. f DSGVO. Wir löschen die Unterlagen 12 Monate nach Abschluss des Falls.

## 11. Daten über Dritte in Events

Events enthalten oft Namen von Künstlerinnen und Künstlern, DJs, Kollektiven und Veranstaltenden. Diese Angaben stammen von Veranstalter:innen, Scouts oder aus öffentlichen Ankündigungen wie Flyern und Event-Seiten. Wir veröffentlichen sie, um über öffentliche Kulturveranstaltungen zu informieren (Art. 6 Abs. 1 lit. f DSGVO). Wer genannt ist und das nicht möchte, kann jederzeit widersprechen, siehe Abschnitt 13.

## 12. Offene Daten und API

Event-Daten einschließlich Anzeigenamen und genannter Personen stehen über Website und API unter der Open Database License (ODbL) zur Verfügung. Andere dürfen sie weiterverwenden und sind dafür selbst verantwortlich. Was wir löschen, verschwindet aus unserer Datenbank und der API. Bereits erstellte Kopien Dritter können wir nicht zurückholen.

## 13. Deine Rechte

Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20 DSGVO). Schreib dazu an [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).

**Widerspruchsrecht:** Verarbeiten wir Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO, kannst du aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit widersprechen (Art. 21 DSGVO).

Du kannst dich außerdem bei einer Aufsichtsbehörde beschweren. Zuständig für uns ist die Berliner Beauftragte für Datenschutz und Informationsfreiheit, Alt-Moabit 59–61, 10555 Berlin.

## 14. Stand

${LEGAL_UPDATED}
`
