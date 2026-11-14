# Übergabe an Codex: Haushaltsbuch-App auf GitHub bringen und prüfen

Stand: 14.11.2026 (2. Runde nach deinem Review) · Erstellt von Claude (Projekt „Haushaltsbuch“)

> **2. Runde:** Die Befunde aus deinem `REVIEW.md` sind umgesetzt (siehe Abschnitt „Umsetzung“ dort). Die persönlichen Daten sind aus dem Code entfernt. Bitte die Datenschutzprüfung erneut durchführen und bei Bestehen Teil 1 (Hochladen) abschließen. Teil 2 entfällt; bitte nur prüfen, ob die Befunde aus deiner Sicht erledigt sind, und das im Bericht ergänzen.

## Worum es geht
Eine private Haushaltsbuch-App als installierbare Web-App (PWA) für Windows-PC und iPhone.
Technik: React 19 + TypeScript + Vite, lokale Datenbank IndexedDB (Dexie), eigene SVG-Diagramme, vite-plugin-pwa.
Es gibt **keinen Server** und **keine Geheimnisse/Schlüssel** im Code. Die Finanzdaten liegen nur lokal im Browser.

**Dein Auftrag hat zwei Teile:**
1. Den Code in ein neues GitHub-Repository hochladen und über GitHub Pages online stellen.
2. Den Code prüfen und einen Prüfbericht schreiben. **Nur berichten, nichts umbauen.**

## Wo der Code liegt
`C:\Users\matte\haushaltsbuch\app` – **nur dieser Ordner** wird das Repository.

⚠️ Der übergeordnete Ordner enthält die **echten Excel-Finanzdaten**. Diese dürfen **niemals** ins Repository. Lege das Git-Repository deshalb ausschließlich in `app\` an, nicht eine Ebene höher.
⚠️ Im Ordner `app\privat\` liegt `startdaten.json` mit persönlichen Fixkosten/Töpfen – per `.gitignore` ausgeschlossen, **nicht hochladen**.

## Absolute Regeln
- **Keine persönlichen Daten hochladen.** Ausgeschlossen bleiben: `privat/` (persönliche Startdaten), `src/demo/` (Testdaten aus den echten Excel-Dateien), alle `*.xlsx`, `*.csv`, Sicherungsdateien `haushaltsbuch-sicherung-*.json`, `node_modules/`, `dist/`, `dist-preview/`. Die `.gitignore` regelt das bereits – **nicht verändern oder lockern**.
- Vor dem ersten Push prüfen: `git status` und `git ls-files` dürfen **keine** der oben genannten Dateien enthalten. Zusätzlich die versionierten Dateien nach Namen, Beträgen und Vertragsdaten durchsuchen: Abgleich mit `privat/startdaten.json` – **kein** Name, Anbieter oder Betrag daraus darf in einer versionierten Datei vorkommen. Die Testdaten in `src/lib/logic.test.ts` sind frei erfunden (Jahr 2030).
- **Keine Funktionen, Berechnungen oder Designs ändern.** Ausnahmen sind nur Änderungen, die für Build/Deployment zwingend nötig sind. Jede solche Änderung im Bericht auflisten.
- Kein `--force`-Push, keine Löschungen außerhalb des Repos.

## Teil 1: Hochladen & online stellen
1. Im Ordner `app`: `npm ci`, `npm test`, `npm run build` – alles muss fehlerfrei durchlaufen. Erwartet: **41 Tests** in `src/` (Stand 14.11.2026, Phase 6 Synchronisation inkl. Zeitstempel-Korrektur). Lokal beim Nutzer kann ein zusätzlicher Test aus `privat/` mitlaufen (prüft mit den echten Excel-Dateien); der gehört nicht ins Repository.
2. Git ist bereits initialisiert (Branch `main`). Datenschutz-Prüfung wie oben, dann erster Commit.
3. Neues GitHub-Repository **`haushaltsbuch`** im Konto des Nutzers anlegen.
   - Hinweis: GitHub Pages ist im kostenlosen Konto nur für **öffentliche** Repositories verfügbar. Das ist hier unkritisch, weil keine Daten und keine Geheimnisse im Code sind. Falls der Nutzer ein Pro-Konto hat, geht auch privat. Im Zweifel den Nutzer fragen.
4. Push auf `main`.
5. In den Repository-Einstellungen: **Settings → Pages → Source: „GitHub Actions“**.
6. Die Workflow-Datei liegt bereits unter `.github/workflows/deploy.yml` (von dir verschoben). Falls im Projektordner noch eine `github-workflow-deploy.yml` liegt, ist sie identisch und kann entfallen. Der Workflow baut bei jedem Push auf `main` automatisch (`npm ci` → `npm test` → `npm run build`) und veröffentlicht `dist/`. Prüfen, dass der erste Lauf grün ist.
7. Die App aufrufen: `https://<benutzername>.github.io/haushaltsbuch/`. Prüfen, dass sie lädt, keine Konsolenfehler zeigt und das Manifest/den Service Worker findet. Die App nutzt relative Pfade (`base: './'`), Unterordner-Pfade funktionieren also.

## Teil 2: Code-Prüfung (Bericht als `REVIEW.md` im Repo, separater Commit)
Bitte prüfen und mit Schweregrad (hoch/mittel/niedrig) und Datei+Zeile berichten:
- **Datenschutz & Sicherheit:** versehentlich enthaltene Daten, unsichere Muster (z. B. `dangerouslySetInnerHTML`, `eval`), Abhängigkeiten (`npm audit`).
- **Rechenlogik:** `src/lib/calc.ts`, `src/lib/recurring.ts`, `src/db/actions.ts` – Randfälle (Monatsende, Jahreswechsel, negative Beträge/Gutschriften, gelöschte Einträge, Preisänderungen). Die fachlichen Regeln stehen in `README.md` und in den Kommentaren. Beträge sind immer ganze **Cent**.
- **Daten & spätere Synchronisation:** Jeder Datensatz hat `id`, `updatedAt`, `deviceId`, `deleted` (Löschen = Markierung). Fixkosten-Instanzen haben deterministische IDs (`rec:<vorlage>:<monat>`). Ist das konsequent umgesetzt?
- **PWA/iOS:** Manifest, Icons, Service-Worker-Update-Verhalten, Safe-Area, Verhalten als Home-Bildschirm-App.
- **Barrierefreiheit & Mobilbedienung:** Tippflächen ≥ 40 px, Kontraste, Fokus.
- **Code-Qualität:** TypeScript-Strenge, offensichtliche Bugs, unnötige Komplexität.

Gefundene Probleme **nicht selbst beheben**, sondern im Bericht beschreiben und einen Lösungsvorschlag machen. Der Nutzer entscheidet danach, was umgesetzt wird.

## Rückmeldung an den Nutzer
- Link zum Repository und zur Live-App
- Ergebnis von Tests, Build und `npm audit`
- Liste aller Änderungen, die du für das Deployment machen musstest
- Zusammenfassung des Prüfberichts (wichtigste Punkte zuerst)

## Was als Nächstes kommt (nicht Teil deines Auftrags)
- Excel-Import direkt in der App (läuft im Browser, Daten verlassen das Gerät nicht)

## Phase 6 – verschlüsselte Google-Drive-Synchronisation (Stand 14.11.2026)

- `src/config.ts`: öffentliche OAuth-Client-ID (darf im Frontend stehen). **Kein Clientschlüssel** – wird nicht benötigt und darf nie ins Repository.
- `src/sync/crypto.ts`: AES-256-GCM (WebCrypto). Datenschlüssel, eingepackt per PBKDF2-SHA256 (600.000 Iterationen) mit Tresor-Passwort bzw. Wiederherstellungsschlüssel. `vault.json` enthält nur eingepackte Schlüssel.
- `src/sync/drive.ts`: Drive-REST nur im versteckten App-Ordner (Scope `drive.appdata`).
- `src/sync/engine.ts`: je Gerät eigene Änderungspakete `ops-*.enc`, Gesamtstände `snap-*.enc` (wöchentlich bzw. nach 40 Paketen, 10 bleiben). Zusammenführung je Datensatz „neuer gewinnt“, Konfliktprotokoll mit Wiederherstellung.
- `src/sync/auth.ts`: Google Identity Services Token-Client, Token ca. 1 h, keine Refresh-Tokens; danach Knopf „Bei Google anmelden“.
- `src/sync/controller.ts`: automatische Synchronisation (Start, Rückkehr in die App, online, 4 s nach Änderungen, alle 3 min).
- Automatisch erzeugte Datensätze (Startdaten, Fixkosten-Monatseinträge) tragen den Zeitstempel `2000-01-01` (`GENESIS`), damit echte Änderungen immer gewinnen.
- Wiederherstellen einer Sicherung stempelt alle Datensätze neu und markiert fehlende als gelöscht (wirkt so auch auf anderen Geräten).
- Zeitstempel (nach Codex-Review): `nowIso()` ist eine hybride logische Uhr – streng steigend, nie zwei gleiche Werte, läuft bei zurückgestellter Geräteuhr weiter vorwärts und berücksichtigt empfangene Zeitstempel (`observeTime`, gespeichert als `sync:clock`, geladen per `initClock()` beim App-Start). Upload-Cursor mit 10-Sekunden-Sicherheitsfenster und Liste bereits gesendeter Fassungen (`sync:recent`).
- Konflikterkennung (nach 2. Codex-Review): Jede Datei enthält den Kenntnisstand des Absenders (`seen`: je Gerät höchster empfangener Zeitstempel). Kannte der Absender unsere Fassung nicht, war die Änderung gleichzeitig → unterlegene Fassung ins Konfliktprotokoll, auch wenn beide schon hochgeladen hatten. Automatisch erzeugte Einträge (GENESIS) und ältere eigene Fassungen zählen nicht als Konflikt.
- Tests: `src/sync/sync.test.ts` (Verschlüsselung, gleichzeitige Uploads + zwei/drei simulierte Geräte, gleiche Millisekunde, verspätet gespeicherte Änderung, vorgehende Geräteuhr).
