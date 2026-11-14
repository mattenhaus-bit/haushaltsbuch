# Code-Review Haushaltsbuch

Stand: 14.11.2026

## Kurzfazit

Der Code baut mit strengem TypeScript fehlerfrei, und alle 12 vorhandenen Tests bestehen. Die Kernlogik verwendet konsequent ganze Cent, blendet gelöschte Buchungen in Auswertungen aus und erzeugt Fixkosten- sowie Topf-Instanzen mit deterministischen IDs. PWA-Manifest, Service Worker, iOS-Metadaten, Safe-Area-Abstände und reduzierte Bewegung sind vorhanden.

Eine Veröffentlichung des aktuellen Stands als öffentliches GitHub-Repository ist dennoch nicht vertretbar: Die Startdaten enthalten aus den echten Excel-Dateien übernommene persönliche Finanzdetails. Daneben wurden vier funktionale bzw. strukturelle Risiken mittlerer Schwere und mehrere Barrierefreiheits-/PWA-Punkte niedriger Schwere gefunden. Es wurden keine Funktionen geändert.

## Befunde

### Hoch – Persönliche Finanzdaten sind Bestandteil des Quellcodes

- **Dateien/Zeilen:** `src/db/seed.ts:1-3`, `src/db/seed.ts:13`, `src/db/seed.ts:32-38`, `src/db/seed.ts:94-118`; zusätzlich konkrete, offenbar aus diesen Daten abgeleitete Werte in `src/lib/logic.test.ts:38-44` und `src/lib/logic.test.ts:79-114`.
- **Beobachtung:** Der Kommentar bezeichnet die Startdaten ausdrücklich als aus der privaten Excel-Datei übernommen. Enthalten sind ein Personenname, Anbieter/Vertragsarten, Fälligkeitstage, Laufzeiten, Preisänderungen, konkrete Fixkosten, Rücklagenbeträge und ein Mindestbestand. Die Übergabe erlaubt den Kategorienamen in `seed.ts`, verbietet vor dem Push aber Treffer mit Beträgen oder Datumslisten aus der Excel.
- **Auswirkung:** Ein öffentliches Repository und die ausgelieferte JavaScript-Datei würden diese persönlichen Finanzinformationen weltweit offenlegen. `.gitignore` schützt nur `src/demo/`, Excel-/CSV- und Sicherungsdateien; eingecheckte Werte in TypeScript-Dateien werden dadurch nicht ausgeschlossen.
- **Vorschlag:** Vor der Veröffentlichung alle realen Start- und Testwerte durch klar fiktive Beispieldaten ersetzen oder die App ohne persönliche Seed-Daten starten lassen. Danach erneut nach Namen, Beträgen und Datumslisten suchen. Diese Änderung ist fachlich vom Nutzer freizugeben und wurde im Review nicht vorgenommen.

### Mittel – Geändertes Datum einer Umbuchung aktualisiert den Budgetmonat nicht

- **Dateien/Zeilen:** `src/components/EntrySheet.tsx:232`, `src/db/actions.ts:120-125`.
- **Beobachtung:** Beim Bearbeiten einer Umbuchung wird ein neues `date`, aber kein neues `month` übergeben. `updateTx` leitet den Monat nur bei Ausgaben neu ab. Einnahmen setzen ihren Monat im Formular ausdrücklich, Umbuchungen nicht.
- **Auswirkung:** Wird eine Umbuchung über eine Monatsgrenze verschoben, bleibt sie in Auswertungen im alten Monat. `summarizeMonth` filtert ausschließlich über `t.month` (`src/lib/calc.ts:31-38`).
- **Vorschlag:** Beim Bearbeiten einer Umbuchung den Monat aus dem neuen Datum setzen oder die Ableitung zentral in `updateTx` für alle Buchungsarten definieren; dazu einen Jahreswechsel-Test ergänzen.

### Mittel – Kategorien-Zusammenführen lässt Referenzen in Stammdaten zurück

- **Dateien/Zeilen:** `src/db/actions.ts:148-156`; betroffene Referenzen sind in `src/db/schema.ts:43`, `src/db/schema.ts:90`, `src/db/schema.ts:97` definiert.
- **Beobachtung:** `mergeCategory` hängt Transaktionen und Unterkategorien um, nicht aber Fixkosten-Vorlagen (`Recurring.categoryId`), Budgets (`Budget.categoryId`) oder Händlerregeln (`MerchantRule.categoryId`).
- **Auswirkung:** Neue Fixkosten und automatisch kategorisierte Einkäufe können weiterhin auf die archivierte Quellkategorie zeigen; vorhandene Budgets können verwaisen. Die Zusammenführung ist damit nicht vollständig.
- **Vorschlag:** Alle Tabellen mit `categoryId` in einer Dexie-Transaktion umhängen und mit einem Integrationstest absichern.

### Mittel – Sync-Metadaten sind nicht für jeden Datensatz vollständig garantiert

- **Dateien/Zeilen:** `src/db/schema.ts:5-11`, `src/db/schema.ts:102-105`, `src/db/meta.ts:26-29`, `src/db/seed.ts:127-139`.
- **Beobachtung:** `deleted` ist optional und wird bei neuen/gesäten Datensätzen meist nicht als `0` gespeichert. `Setting` besitzt überhaupt keine `id`, `updatedAt`, `deviceId` oder `deleted`-Felder. Die Aussage in README und Übergabe, jeder Datensatz habe diese Felder, trifft daher wörtlich nicht zu.
- **Auswirkung:** Eine spätere Synchronisation muss fehlende Werte normalisieren und für Einstellungen einen separaten Konfliktmechanismus vorsehen. Andernfalls können Vergleiche oder Löschkonflikte inkonsistent werden.
- **Vorschlag:** Vor Implementierung der Synchronisation das Schema verbindlich festlegen: `deleted: 0 | 1` verpflichtend machen und Settings entweder ausdrücklich als lokal dokumentieren oder ebenfalls synchronisierbar modellieren. Eine Migration und Sync-Vertragstests vorsehen.

### Mittel – Abhängigkeitsprüfung meldet sechs Schwachstellen

- **Datei:** `package-lock.json` (transitive Abhängigkeiten von `vite-plugin-pwa`/Workbox).
- **Beobachtung:** `npm audit` meldet 6 Schwachstellen: 2 niedrig, 4 mittel. Betroffen sind `deepmerge`, `glob` und `minimatch` über den Build-/PWA-Werkzeugpfad. Der angebotene automatische Fix würde `vite-plugin-pwa` auf 1.1.0 zurücksetzen und wird als Breaking Change ausgewiesen.
- **Auswirkung:** Die gemeldeten Pfade betreffen nach aktuellem Abhängigkeitsbaum die Entwicklungs-/Build-Werkzeuge, nicht direkt die im Browser laufende Haushaltslogik. Manipulierte oder unkontrollierte Glob-Eingaben sind im vorhandenen Build nicht erkennbar; das unmittelbare Laufzeitrisiko ist deshalb begrenzt, der CI-Build bleibt aber von verwundbaren Paketen abhängig.
- **Vorschlag:** Nicht `npm audit fix --force` verwenden. Upstream-Updates von `vite-plugin-pwa`/Workbox prüfen, kontrolliert aktualisieren und anschließend Tests, Build und PWA-Funktion wiederholen.

### Niedrig – Preis vor dem ersten Eintrag der Historie wird rückwirkend angewendet

- **Datei/Zeilen:** `src/lib/recurring.ts:20-25`.
- **Beobachtung:** `priceFor` initialisiert den Betrag mit dem ersten Preis, auch wenn dessen `from` nach dem abgefragten Monat liegt.
- **Auswirkung:** Bei einer Vorlage, deren `start` vor dem ersten Preiseintrag liegt, wird der zukünftige Preis rückwirkend verwendet. Die aktuellen Seeds beginnen jeweils mit einem passenden Preis, sodass der Fehler dort nicht sichtbar wird.
- **Vorschlag:** Eingaben so validieren, dass spätestens zum Startmonat ein Preis existiert, oder für Monate vor dem ersten Preis einen definierten Fehler/Leerwert liefern; Randfall testen.

### Niedrig – Mehrere klickbare Zeilen sind nicht per Tastatur bedienbar

- **Dateien/Zeilen:** `src/screens/More.tsx:57`, `src/screens/More.tsx:72`, `src/screens/More.tsx:82`, `src/screens/More.tsx:96`, `src/screens/More.tsx:102`, `src/screens/Bills.tsx:18`, `src/screens/Bills.tsx:65`, `src/screens/Overview.tsx:197`, `src/screens/Transactions.tsx:66`.
- **Beobachtung:** Interaktive Zeilen sind `div`-Elemente mit `onClick`, aber ohne Button-/Link-Semantik, `tabIndex` oder Tastaturbehandlung.
- **Auswirkung:** Tastatur- und viele Assistive-Technology-Nutzer können diese Bearbeitungsaktionen nicht zuverlässig erreichen oder auslösen.
- **Vorschlag:** Semantische Buttons/Links verwenden oder vollständige Tastatursemantik mit sichtbarem Fokus ergänzen. Vorzugsweise die ganze Zeile als korrekt gestalteten Button ausführen.

### Niedrig – Dialoge verwalten Fokus und Hintergrundinteraktion nicht vollständig

- **Datei/Zeilen:** `src/components/ui.tsx:7-21`.
- **Beobachtung:** Das Sheet hat `role="dialog"`, aber kein `aria-modal`, keinen Fokusfang, keine Escape-Behandlung und keine dokumentierte Fokus-Rückgabe an den Auslöser.
- **Auswirkung:** Screenreader- und Tastaturnutzer können in den Hintergrund navigieren oder verlieren beim Schließen ihre Position.
- **Vorschlag:** Modale Semantik, initialen Fokus, Escape, Fokusfang und Fokus-Rückgabe ergänzen; automatisiert mit axe und manuell per Tastatur testen.

### Niedrig – Einzelne mobile Tippflächen unterschreiten 40 px

- **Datei/Zeilen:** `src/styles.css:194-195`, `src/styles.css:267`, `src/styles.css:286`.
- **Beobachtung:** Checkboxen sind mobil 34 × 34 px, Schließen-Schaltflächen 34 × 34 px. Die Übergabe fordert mindestens 40 px.
- **Auswirkung:** Die Bedienung ist auf kleinen Touchscreens unnötig fehleranfällig.
- **Vorschlag:** Interaktive Fläche auf mindestens 40 × 40 px erhöhen, ohne zwingend das sichtbare Symbol zu vergrößern.

### Niedrig – Service-Worker-Updates erfolgen ohne sichtbaren Versionshinweis

- **Datei/Zeilen:** `vite.config.ts:8-10`.
- **Beobachtung:** `registerType: 'autoUpdate'` aktualisiert den Service Worker automatisch. Es gibt keine sichtbare Update-/Reload-Steuerung in der App.
- **Auswirkung:** Ein neuer Stand kann bei nächster Navigation oder neuem App-Start aktiv werden, ohne dass der Nutzer die Versionsänderung nachvollziehen kann. IndexedDB-Daten bleiben grundsätzlich getrennt davon erhalten, doch zukünftige Schemaänderungen benötigen besondere Sorgfalt.
- **Vorschlag:** Für spätere datenmodelländernde Releases einen Update-Hinweis und getestete Dexie-Migrationen vorsehen. Für den aktuellen MVP ist die Konfiguration grundsätzlich funktionsfähig.

## Positiv geprüft

- Keine Verwendung von `dangerouslySetInnerHTML`, `eval`, `new Function` oder unsicheren HTTP-Endpunkten im Anwendungscode gefunden.
- Beträge werden als ganze Cent verarbeitet; deutsche/englische Eingaben und negative Gutschriften sind getestet.
- Monatsende und Jahreswechsel sind für Datumsfunktionen getestet.
- Gelöschte Transaktionen werden in Auswertungen ignoriert; gelöschte deterministische Fixkosteninstanzen werden nicht neu erzeugt.
- Fixkosten-IDs (`rec:<vorlage>:<monat>`) und Topf-IDs (`pot:<topf>:<monat>`) sind deterministisch.
- Preisänderungen aktualisieren nur offene Instanzen; bezahlte Instanzen bleiben unverändert.
- TypeScript läuft mit `strict`, `noUnusedLocals`, `noUnusedParameters` und `noEmit`.
- Manifest enthält Name, Kurzname, Sprache, Start-URL, Standalone-Modus, Theme/Background und 192-/512-px-Icons einschließlich maskable-Deklaration.
- iOS-Metadaten, Apple-Touch-Icon, `viewport-fit=cover`, Safe-Area-Abstände, Dark Mode, sichtbarer Fokus und `prefers-reduced-motion` sind vorhanden.

## Ausgeführte Prüfungen

| Prüfung | Ergebnis |
|---|---|
| `npm ci` | erfolgreich; 424 Pakete installiert |
| `npm test` | erfolgreich; 1 Testdatei, 12/12 Tests bestanden |
| `npm run build` | erfolgreich; TypeScript und Vite-Build, Manifest und Service Worker erzeugt |
| `npm audit --audit-level=low` | 6 Schwachstellen: 2 niedrig, 4 mittel |
| Lokaler Browser-Smoke-Test des Produktions-Builds | App und Manifest-Link laden; 0 Konsolenfehler, 0 Warnungen; Startdaten werden sichtbar in IndexedDB/UI angelegt |
| Suche nach riskanten Browsermustern | keine Treffer für `dangerouslySetInnerHTML`, `eval`, `new Function` |
| Datenschutzsuche | nicht bestanden; reale Startbeträge/-termine und Personenbezug in versionierbaren Quelldateien gefunden |

## Nicht durchgeführt

- Kein Push und keine öffentliche GitHub-Pages-Veröffentlichung, weil die verpflichtende Datenschutzprüfung fehlgeschlagen ist.
- Kein Live-Test der GitHub-Pages-URL, des ausgelieferten Manifests oder des produktiven Service Workers, da keine Veröffentlichung erfolgt ist.
- Keine Funktions-, Berechnungs-, Design- oder Abhängigkeitsänderung im Rahmen dieses Reviews.

## Umsetzung (Claude, 14.11.2026)

| Befund | Status | Umsetzung |
|---|---|---|
| Hoch – persönliche Daten im Code | ✅ behoben | `seed.ts` enthält nur neutrale Konten/Kategorien/Läden. Persönliche Fixkosten, Töpfe, Namen und Läden liegen in `privat/startdaten.json` (gitignored) und werden in der App über **Mehr → Startdaten hinzufügen** (`mergeImport`) eingelesen. Tests nutzen frei erfundene Werte (Jahr 2030). Platzhaltertext und Kommentare bereinigt. Projektweite Suche nach Namen/Beträgen: keine Treffer. |
| Mittel – Umbuchung behält alten Monat | ✅ behoben | `updateTx` leitet den Budgetmonat für Ausgaben **und** Umbuchungen aus dem neuen Datum ab (außer ein Monat wird ausdrücklich übergeben). Test über Jahreswechsel ergänzt. |
| Mittel – Kategorien-Merge unvollständig | ✅ behoben | `mergeCategory` hängt in einer Transaktion Buchungen, Unterkategorien, Fixkosten-Vorlagen, Händlerregeln und Pläne um (Pläne werden in der Zielkategorie addiert). Integrationstest ergänzt. |
| Mittel – Sync-Metadaten | ✅ behoben | `stamp()` setzt `deleted: 0` standardmäßig, Seed und Import ebenso. `settings` ausdrücklich als gerätebezogen/nicht synchronisiert dokumentiert. Test prüft alle Tabellen auf id/updatedAt/deviceId/deleted. |
| Mittel – npm audit | ✅ teilweise | Über `overrides` auf `glob@14.0.6` und `minimatch@11.0.8` angehoben → die 4 mittleren Befunde sind weg. Verbleibend: 4 **niedrig** (`deepmerge` über `@rollup/plugin-node-resolve` in `workbox-build`), ohne verfügbare Upstream-Korrektur; betrifft nur den Build-Schritt, nicht die ausgelieferte App. Build und Service Worker erneut geprüft. |
| Niedrig – Preis vor erstem Eintrag | ✅ behoben | `priceFor` liefert vor dem ersten Preiseintrag 0 €, nie rückwirkend. Test ergänzt. |
| Niedrig – Tastaturbedienung Zeilen | ✅ behoben | Klickbare Zeilen über `pressable()` mit `role="button"`, `tabIndex=0`, Enter/Leertaste und sichtbarem Fokus. |
| Niedrig – Dialog-Fokus | ✅ behoben | `aria-modal`, initialer Fokus, Fokusfang (Tab/Shift+Tab), Escape (war bereits vorhanden), Fokus-Rückgabe an den Auslöser, Hintergrund-Scroll gesperrt. |
| Niedrig – Tippflächen < 40 px | ✅ behoben | Häkchen und Schließen-Knopf 40 × 40 px. |
| Niedrig – Update ohne Hinweis | ✅ behoben | `registerType: 'prompt'` + Hinweisleiste „Neue Version verfügbar – Aktualisieren/Später“; Prüfung auf Updates beim Zurückkehren in die App. |

## Nachprüfung durch Codex (2. Runde, 14.11.2026)

Die Umsetzung wurde anhand des geänderten Codes, der erweiterten Tests und einer erneuten Datenschutzprüfung kontrolliert. Die oben aufgeführten funktionalen, Synchronisations-, Barrierefreiheits- und PWA-Befunde sind aus meiner Sicht erledigt. Persönliche Startdaten befinden sich nur in `privat/startdaten.json`; der gesamte Ordner `privat/` wird durch `.gitignore` ausgeschlossen und ist nicht Bestandteil der Veröffentlichung. Die öffentlich vorgesehenen Seed-Daten sind neutral, die Testwerte sind frei erfunden und verwenden das Jahr 2030.

Erneute Prüfergebnisse: `npm ci` erfolgreich; `npm test` mit 18/18 bestandenen Tests; `npm run build` erfolgreich einschließlich Manifest und Service Worker. `npm audit` meldet noch 4 Schwachstellen niedriger Schwere in transitiven Build-/PWA-Abhängigkeiten (`deepmerge` über Workbox/`vite-plugin-pwa`); der angebotene automatische Fix wäre ein Breaking Change. Der frühere Audit-Befund ist damit reduziert, aber abhängigkeitsseitig noch nicht vollständig beseitigt und sollte weiter über kontrollierte Upstream-Updates beobachtet werden.

Prüfungen danach: `npm test` 18/18 bestanden, `npm run build` erfolgreich (Service Worker erzeugt und im Browser registriert), Browser-Test ohne Konsolenfehler, Start ohne persönliche Daten bestätigt, Import der Startdatei bestätigt.
