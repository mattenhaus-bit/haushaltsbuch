# Haushaltsbuch – App (Version 0.1, MVP)

Persönliches Haushaltsbuch als installierbare Web-App (PWA) für Windows-PC und iPhone.
Fachliche Grundlage: eine bestehende Excel-Haushaltsbuchvorlage. Konzept: siehe Projektdokumente (Phase 1–3).

## Stand
**Fertig und getestet (MVP):**
- Schnellerfassung: Ausgabe, **Einkauf** (mehrere Läden pro Tour, Händlererkennung), Einnahme (Gehalt ab dem 25. → Folgemonat), Umbuchung
- Fixkosten-Vorlagen mit Preis-Historie, automatische Monatsanlage, Abhaken wie in Excel
- Neuer Version-Hinweis („Neue Version verfügbar“), Tastaturbedienung, modale Dialoge mit Fokusführung
- Rücklagen-Töpfe auf dem Tagesgeld für unregelmäßige Kosten, „aus Topf bezahlen“
- Übersicht: Verfügbar/Fehlbetrag (Zero-Based), „Aus Tagesgeld ausgleichen“, „investieren“, Kategorien mit Plan (Ø 3 Monate)
- Jahresansicht (Matrix wie ANNUAL TOTALS, Sparquote, Top-10), Buchungsliste mit Suche
- Kategorien (2 Ebenen), Läden, Konten, Töpfe verwalten; Dark Mode; JSON-Sicherung

**Excel-Import (14.11.2026):** Mehr → Excel-Import. Liest die Haushaltsbuch-Vorlage (Monatsblätter JAN–DEC + Einkaufsliste) direkt im Browser, zeigt einen Prüfbericht je Monat (Excel = App) und übernimmt erst nach Bestätigung. Feste IDs verhindern Doppelte, Import pro Jahr wieder entfernbar, automatische Sicherung vorher.

**Synchronisation:** verschlüsselt über den versteckten App-Ordner in Google Drive (Mehr → Synchronisation).

**Noch nicht enthalten:** Jahres-Finanzbericht mit KI (v1.1).
Die Daten liegen bis dahin **nur lokal im Browser** – bitte regelmäßig unter „Mehr → Sicherung herunterladen“ sichern.

## Auf dem PC starten
Voraussetzung: [Node.js](https://nodejs.org) (LTS) installiert.

```bash
cd haushaltsbuch/app
npm install
npm run dev        # Entwicklungsmodus → http://localhost:5173
npm test           # Rechenlogik-Tests
npm run build      # fertige App in dist/
npm run preview    # gebaute App lokal ansehen (installierbar als App über das Browsermenü)
```

Aufs iPhone kommt die App, sobald sie unter einer festen HTTPS-Adresse liegt (kostenlos, z. B. GitHub Pages) – das ist Teil von Phase 6.

## Persönliche Daten – nie im Repository
Die App startet mit **neutralen** Kategorien. Persönliche Startdaten (Fixkosten, Töpfe, eigene Läden) liegen in
`privat/startdaten.json` und werden in der App unter **Mehr → Startdaten hinzufügen** eingelesen.
`privat/`, `src/demo/`, Excel-/CSV-Dateien und Sicherungen sind per `.gitignore` ausgeschlossen.
`npm run build:preview` erzeugt eine Ein-Datei-Vorschau, die – falls vorhanden – diese privaten Dateien einbindet; diese Datei nie veröffentlichen.

## Aufbau
```
src/
  lib/       money.ts (Cent-Beträge), dates.ts (Monate, Budgetmonat), recurring.ts (Fixkosten), calc.ts (alle Auswertungen)
  db/        schema.ts (Datenmodell, IndexedDB/Dexie), seed.ts (Startdaten aus Excel), actions.ts (alle Änderungen), meta.ts (Sync-Felder)
  screens/   Overview, Transactions, Bills, Year, More
  components EntrySheet (Erfassung), Charts (SVG), ui
```
Jeder synchronisierbare Datensatz hat `id`, `updatedAt`, `deviceId` und `deleted` (0/1, Löschen = Markierung) – Grundlage für die konfliktfreie Synchronisation. Einstellungen (`settings`) sind gerätebezogen und werden nicht synchronisiert.
