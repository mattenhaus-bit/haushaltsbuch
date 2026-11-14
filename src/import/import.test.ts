/**
 * Import-Tests mit einer künstlich erzeugten Excel-Datei (frei erfundene Werte, Jahr 2030).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readWorkbook } from './xlsx';
import { analyzeWorkbook, guessYear, looksLikeTemplate } from './excel';
import { applyImport, removeImport } from './apply';
import { db, useTestDb } from '../db/schema';
import { seedIfEmpty } from '../db/seed';
import { summarizeMonth } from '../lib/calc';
import * as A from '../db/actions';

type Cells = Record<string, string | number | boolean>;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function sheetXml(cells: Cells, merges: string[] = []) {
  const rows = new Map<number, string[]>();
  for (const [ref, v] of Object.entries(cells)) {
    const r = Number(ref.replace(/[A-Z]+/, ''));
    const c = typeof v === 'boolean' ? `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`
      : typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    rows.set(r, [...(rows.get(r) ?? []), c]);
  }
  const body = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => `<row r="${r}">${cs.join('')}</row>`).join('');
  const m = merges.length ? `<mergeCells>${merges.map((x) => `<mergeCell ref="${x}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData>${m}</worksheet>`;
}
function makeXlsx(sheets: { name: string; cells: Cells; merges?: string[] }[]) {
  const files: Record<string, Uint8Array> = {};
  files['xl/workbook.xml'] = strToU8(`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.cells, s.merges)); });
  return zipSync(files);
}

// Beispiel-Monat (Januar 2030): Einkommen 3.000, Miete 900 (abgehakt), Abo 20 (nicht abgehakt),
// Ausgaben Lebensmittel 150 + Tanken 50, Rate 30, Tagesgeld 1.000
const jan: Cells = {
  C21: 'Arbeitseinkommen', D21: 47119 /* 01.01.2029 */, H21: 3000,
  J13: true, K13: 'Miete', P13: 900, J14: false, K14: 'Streaming', P14: 20,
  S13: 'Lebensmittel', W13: 150, S14: 'Tanken', W14: 50,
  Z13: 'Handyrate', AE13: 30,
  Z30: 'Tagesgeld', AE30: 1000
};
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function sampleWorkbook(extraJournal: Cells = {}) {
  return readWorkbook(makeXlsx([
    { name: 'Kostenstruktur', cells: { B2: 'Januar', B3: '04.01.2030', C3: 'aldi', D3: 60, C4: 'lidl', D4: 70, B5: '10.01.2030', C5: 'aral', D5: 50, B6: '12.01.2O30', C6: 'markt', D6: '9,5', ...extraJournal }, merges: ['B3:B4'] },
    ...months.map((m) => ({ name: m, cells: m === 'JAN' ? jan : {} }))
  ]));
}

describe('Excel-Import', () => {
  let n = 0;
  beforeEach(async () => {
    useTestDb(`imp-${n++}`);
    await seedIfEmpty();
    await A.setSetting('startMonth', '2030-06');
  });
  const ctx = async () => ({
    categories: await db.categories.toArray(), recurring: await db.recurring.toArray(), merchants: await db.merchants.toArray(),
    accounts: await db.accounts.toArray(), budgetAcc: 'acc-giro', startMonth: '2030-06'
  });

  it('liest die Vorlage und erkennt das Jahr', () => {
    const wb = sampleWorkbook();
    expect(looksLikeTemplate(wb)).toBe(true);
    expect(guessYear(wb, 'Finanzen 2030.xlsx')).toBe(2030);
  });

  it('Monatswerte stimmen mit der Excel überein (Einzelkäufe + Abgleich)', async () => {
    const r = analyzeWorkbook(sampleWorkbook(), 2030, 'details', await ctx());
    expect(r.months).toHaveLength(1);
    const m = r.months[0];
    expect(m.ok).toBe(true);
    expect(m.excel).toEqual({ income: 300000, bills: 90000, expenses: 20000, debts: 3000, savings: 100000, balance: 300000 - 90000 - 20000 - 3000 - 100000 });
    expect(r.stats.unpaidBills).toBe(1); // nicht abgehakt → wie in Excel nicht gezählt
    // Einkaufstour (verbundenes Datum) erkannt
    const trip = r.txs.filter((t) => t.tripId);
    expect(trip.map((t) => t.amount)).toEqual([6000, 7000]);
    // Lebensmittel laut Excel 150, Einzelkäufe 130 → Abgleich +20; Tanken 50 = 50; „markt“ 9,50 unbekannt → Sonstiges, Abgleich −9,50
    const corr = r.txs.filter((t) => t.text === 'Abgleich mit Excel-Monatsblatt');
    expect(corr.find((t) => t.categoryId === 'exp-lebensmittel')!.amount).toBe(2000);
    expect(corr.find((t) => t.categoryId === 'exp-sonstiges')!.amount).toBe(-950);
  });

  it('Modus „nur Monatssummen“', async () => {
    const r = analyzeWorkbook(sampleWorkbook(), 2030, 'sums', await ctx());
    expect(r.months[0].ok).toBe(true);
    expect(r.txs.filter((t) => t.kind === 'expense')).toHaveLength(2);
  });

  it('Übernehmen, erneut importieren ohne Doppelte, rückgängig machen', async () => {
    const r = analyzeWorkbook(sampleWorkbook(), 2030, 'details', await ctx());
    await applyImport(r, 'Finanzen 2030.xlsx');
    const s = summarizeMonth('2030-01', await db.transactions.toArray(), 'acc-giro');
    expect(s.income).toBe(300000);
    expect(s.expenses).toBe(20000);
    expect(s.bills).toBe(93000);
    expect(s.savedOrInvested).toBe(100000);
    expect(s.available).toBe(r.months[0].excel.balance);
    const count1 = (await db.transactions.toArray()).filter((t) => !t.deleted).length;
    // zweiter Import (z. B. nach Korrektur in Excel) → gleiche IDs, keine Doppelten; entfallene Zeile wird entfernt
    const r2 = analyzeWorkbook(sampleWorkbook(), 2030, 'details', await ctx());
    await applyImport(r2);
    expect((await db.transactions.toArray()).filter((t) => !t.deleted).length).toBe(count1);
    expect(await A.getSetting('backup:vorImport', null)).not.toBeNull();
    await removeImport(2030);
    expect((await db.transactions.toArray()).filter((t) => !t.deleted && t.source?.startsWith('excel:2030')).length).toBe(0);
  });

  it('Monate ab dem App-Start werden nicht importiert', async () => {
    const r = analyzeWorkbook(sampleWorkbook(), 2030, 'details', { ...(await ctx()), startMonth: '2030-01' });
    expect(r.months).toHaveLength(0);
    expect(r.txs).toHaveLength(0);
  });

  it('„Plus“-Beträge werden als Erlös (negativ) übernommen', async () => {
    const r = analyzeWorkbook(sampleWorkbook({ B7: '15.01.2030', C7: 'verkauf', D7: 'Plus 40' }), 2030, 'details', await ctx());
    expect(r.txs.find((t) => t.id === 'imp:2030:kauf:7')!.amount).toBe(-4000);
    expect(r.months[0].ok).toBe(true);
  });
});
