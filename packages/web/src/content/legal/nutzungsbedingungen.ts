import { CONTACT_EMAIL, LEGAL_UPDATED, OPERATOR_NAME } from './operator'

export const nutzungsbedingungen = `
## § 1 Anbieter und Geltung

Kellerkompass (kellerkompass.de) ist ein unentgeltliches, nicht-kommerzielles Projekt von ${OPERATOR_NAME} (Kontakt siehe [Impressum](/impressum)). Diese Bedingungen gelten für die Nutzung der Website und der API.

## § 2 Was Kellerkompass ist

Kellerkompass ist eine offene Datenbank für Veranstaltungen der Berliner Underground- und Community-Szene. Events lesen kann jede Person ohne Account. Events eintragen kann, wer eingeladen wurde. Es gibt keinen Anspruch auf eine bestimmte Verfügbarkeit oder bestimmte Funktionen. Wir können den Dienst ändern oder einstellen.

## § 3 Account und Mindestalter

1. Accounts gibt es nur auf Einladung. Ein Anspruch auf einen Account besteht nicht.
2. Du musst mindestens 18 Jahre alt sein.
3. Accounts können auch für Kollektive, Reihen oder Venues angelegt werden. Verantwortlich ist dann die Person, die den Account angelegt hat.
4. Halte dein E-Mail-Postfach und deinen API-Schlüssel geschützt. Was über deinen Account passiert, wird dir zugerechnet.

## § 4 Rollen

- **Publisher** tragen eigene Events ein und können weitere Personen als Mitverantwortliche hinzufügen. Wer ein Event angelegt hat, kann es absagen und löschen.
- **Scouts** tragen Events anderer Veranstaltender ein. Diese Events werden als „Scout“ gekennzeichnet, haben keinen Eigentümer und können von allen Scouts bearbeitet werden. Die tatsächlichen Veranstaltenden können sie übernehmen.
- Rollen und Verifizierungen vergeben wir nach eigenem Ermessen.

## § 5 Regeln für Inhalte

Erlaubt sind echte Veranstaltungen mit korrekten Angaben. Kommerzielle Veranstaltungen sind ausdrücklich erlaubt. Halte deine Events aktuell und sage sie ab, wenn sie ausfallen.

Nicht erlaubt sind:

- rechtswidrige Inhalte
- diskriminierende Veranstaltungen und Inhalte, etwa rassistische, antisemitische, sexistische, queer- oder transfeindliche oder behindertenfeindliche
- Inhalte, die Gewalt verherrlichen oder zu Gewalt aufrufen
- erfundene, irreführende oder doppelt angelegte Events sowie Spam
- Inhalte, die Rechte Dritter verletzen, insbesondere kopierte Beschreibungstexte oder Bilder
- private Kontaktdaten Dritter, etwa Privatadressen oder Telefonnummern

## § 6 Rechte an deinen Beiträgen (Contributor Terms)

1. Du darfst nur eintragen, wozu du berechtigt bist. Fakten wie Datum, Ort und Line-up darfst du aus jeder Quelle übernehmen. Beschreibungen formulierst du selbst oder hast die Erlaubnis der Urheberin oder des Urhebers.
2. Du räumst dem Betreiber an deinen Beiträgen ein einfaches, weltweites, zeitlich unbegrenztes, unwiderrufliches und unentgeltliches Nutzungsrecht ein. Es umfasst das Speichern, Bearbeiten, Veröffentlichen und Lizenzieren.
3. Der Betreiber veröffentlicht die Datenbank unter der Open Database License 1.0 (ODbL) und einzelne Inhalte unter der Database Contents License 1.0 (DbCL).
4. Der Betreiber darf die Daten künftig auch unter einer anderen freien und offenen Lizenz im Sinne der [Open Definition](https://opendefinition.org/) veröffentlichen. Eine geschlossene, proprietäre Lizenzierung ist ausgeschlossen.
5. Die Namensnennung erfolgt gegenüber der Datenbank „Kellerkompass“, nicht für einzelne Beiträge. Soweit rechtlich zulässig, verzichtest du darauf, als Urheberin oder Urheber einzeln genannt zu werden.
6. Diese Rechte bleiben bestehen, wenn du deinen Account löschst.

## § 7 Meldungen und Moderation

1. Jede Person kann Inhalte über den Link „Report event“ auf der Event-Seite oder per E-Mail an [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) melden. Eine Meldung sollte die genaue Adresse des Inhalts, eine Begründung, warum er rechtswidrig ist oder gegen diese Bedingungen verstößt, Name und E-Mail-Adresse sowie die Erklärung enthalten, dass die Angaben nach bestem Wissen gemacht wurden (Art. 16 DSA).
2. Wir prüfen Meldungen zügig und informieren die meldende Person über unsere Entscheidung.
3. Moderationsentscheidungen trifft ein Mensch. Automatisierte Moderationswerkzeuge setzen wir nicht ein.
4. Mögliche Maßnahmen sind: Inhalte korrigieren, ausblenden oder löschen, Rollen entziehen, Accounts sperren oder löschen.
5. Betrifft eine Maßnahme deine Inhalte oder deinen Account, begründen wir sie per E-Mail (Art. 17 DSA). Du kannst per E-Mail widersprechen, und wir prüfen die Entscheidung erneut. Der Rechtsweg bleibt dir offen.
6. Wer wiederholt offensichtlich rechtswidrige Inhalte einstellt oder wiederholt offensichtlich unbegründete Meldungen schickt, kann gesperrt werden.

## § 8 API

Für die Nutzung der API gelten zusätzlich die Bedingungen auf der Seite [Datenlizenz und API](/lizenz).

## § 9 Account löschen und Beendigung

Du kannst deinen Account jederzeit per E-Mail an [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) löschen lassen. Deine Events bleiben bestehen, die Zuordnung zu dir wird anonymisiert. Wir können Accounts bei Verstößen sperren oder löschen und den Dienst mit angemessener Ankündigung einstellen.

## § 10 Haftung

1. Kellerkompass ist kein Veranstalter. Für Angaben in Events sind die eintragenden Personen verantwortlich. Prüfe wichtige Details im Zweifel bei den Veranstaltenden.
2. Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie bei Schäden an Leben, Körper oder Gesundheit. Im Übrigen ist die Haftung ausgeschlossen, soweit das gesetzlich zulässig ist.

## § 11 Änderungen

Wir können diese Bedingungen ändern. Über wesentliche Änderungen informieren wir dich mindestens vier Wochen vorher per E-Mail. Bist du nicht einverstanden, kannst du deinen Account löschen.

## § 12 Schlussbestimmungen

Es gilt deutsches Recht. Ist eine Bestimmung unwirksam, bleiben die übrigen wirksam.

Stand: ${LEGAL_UPDATED}
`
