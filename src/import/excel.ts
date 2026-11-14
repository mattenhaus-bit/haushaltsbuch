/**
 * Excel-Import für die Haushaltsbuch-Vorlage (Monatsblätter JAN–DEC + Einkaufsliste „Kostenstruktur“).
 * Erzeugt Buchungen nach den im Projekt beschlossenen Regeln und einen Prüfbericht gegen die Excel-Summen.
 * Reine Funktion: schreibt nichts in die Datenbank (das macht apply.ts nach Bestätigung).
 */
import type { Account, Category, MerchantRule, Recurring, Transaction } from '../db/schema';
import { slug } from '../db/seed';
import { compareMonth, type Month } from '../lib/dates';
import { excelDate, type CellValue, type Workbook } from './xlsx';

export type ImportMode = 'details' | 'sums';
export type DraftTx = Omit<Transaction, 'updatedAt' | 'deviceId'>;

export interface ImportContext {
  categories: Category[];
  recurring: Recurring[];
  merchants: MerchantRule[];
  accounts: Account[];
  budgetAcc: string;
  /** Monate ab hier führt die App selbst (Fixkosten automatisch) → werden nicht importiert */
  startMonth?: Month | null;
}

export interface MonthCheck {
  month: Month;
  excel: { income: number; bills: number; expenses: number; debts: number; savings: number; balance: number };
  app: { income: number; bills: number; expenses: number; debts: number; savings: number; balance: number };
  ok: boolean;
}

export interface ImportResult {
  year: number;
  mode: ImportMode;
  txs: DraftTx[];
  newCategories: Omit<Category, 'updatedAt' | 'deviceId'>[];
  newAccounts: Omit<Account, 'updatedAt' | 'deviceId'>[];
  months: MonthCheck[];
  categoryTotals: { categoryId: string; label: string; excel: number; app: number }[];
  warnings: string[];
  stats: { journalRows: number; autoCategorized: number; corrections: number; correctionVolume: number; skippedMonths: Month[]; unpaidBills: number };
}

const MONTH_SHEETS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_WORDS: Record<string, number> = {
  januar: 1, january: 1, februar: 2, february: 2, märz: 3, maerz: 3, march: 3, april: 4, mai: 5, may: 5, juni: 6, june: 6,
  juli: 7, july: 7, august: 8, september: 9, oktober: 10, october: 10, november: 11, dezember: 12, december: 12
};
const pad = (n: number) => String(n).padStart(2, '0');
const cents = (v: number) => Math.round(v * 100);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const SUB = (main: string, sub: string) => `exp-${main}-${slug(sub)}`;

/** Zahl aus einer Zelle (auch Texte wie „9,5“, „=19.99“, „Plus 190“) */
export function numOf(v: CellValue): number | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = v.replace(/€/g, '').replace(/plus/i, '').replace(/^=/, '').replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100) / 100;
}

const text = (v: CellValue) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v === null ? '' : String(v));

// ---------- Zuordnungen (Entscheidungen vom 12./13.11.2026) ----------
const EXCEL_EXPENSE: Record<string, string> = {
  lebensmittel: 'exp-lebensmittel', tanken: SUB('mobilitaet', 'Tanken'), auto: SUB('mobilitaet', 'Auto'),
  'gesundheitspflege/sport': 'exp-gesundheit', gesundheitspflege: 'exp-gesundheit', kleidung: 'exp-kleidung',
  unterhaltung: SUB('freizeit', 'Unterhaltung'), 'geschenke und feiern': SUB('geschenke', 'Geschenke & Feiern'),
  hauswartung: SUB('haus', 'Hauswartung'), 'essen gehen/mitnehmen': SUB('freizeit', 'Essen gehen'),
  'arbeit/kaffee': SUB('freizeit', 'Essen gehen'), elektronik: 'exp-elektronik', pflanzen: SUB('haus', 'Pflanzen'),
  garten: SUB('haus', 'Garten'), sonstige: 'exp-sonstiges', aktivitäten: SUB('freizeit', 'Aktivitäten'),
  haushalt: SUB('haus', 'Haushalt'), 'ausgehen/freunde': SUB('freizeit', 'Ausgehen / Freunde'), spende: SUB('geschenke', 'Spende'),
  holz: 'exp-haus', investitionen: 'exp-projekte', 'projekt investition': 'exp-projekte', 'projekt-investitionen': 'exp-projekte',
  urlaub: 'exp-urlaub'
};
const PROJECTS_CAT = { id: 'exp-projekte', name: 'Projekte & Investitionen', icon: '🏗️', color: '#5c6b80', group: 'expense' as const, order: 20 };

/** Nur Buchstaben/Ziffern, klein – „Gas-Werk A.G.“ und „Gaswerk AG“ werden gleich */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** Unscharfer Namensvergleich für Fixkosten (Tippfehler, Abkürzungen, Zusätze wie „-Rate“) */
export function similarName(a: string, b: string): boolean {
  const x = key(a), y = key(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  return Math.max(x.length, y.length) >= 6 && editDistance(x, y) <= 2;
}

function billCategory(name: string): string {
  const n = norm(name);
  if (/unterhalt/.test(n)) return 'bill-familie';
  if (/versich|haftpflicht/.test(n)) return 'bill-versicherung';
  if (/rate|kredit|darlehen|ausstehend/.test(n)) return 'bill-raten';
  if (/strom|wasser|müll|holz|pellet|kamin|schornstein|gas|heiz|miete/.test(n)) return 'bill-wohnen';
  return 'bill-abos';
}

const FALLBACK_RULES: [RegExp, string][] = [
  [/\b(aldi|lidl|penny|netto|edeka|rewe|kaufland|norma)/, SUB('lebensmittel', 'Supermarkt')],
  [/(eier|bauer|hofladen)/, SUB('lebensmittel', 'Bauer / Eier')],
  [/(bäcker|baecker)/, SUB('lebensmittel', 'Bäcker')],
  [/\b(tanken|tankstelle|aral|esso|shell|jet|sprit)\b/, SUB('mobilitaet', 'Tanken')],
  [/(parken|parkhaus)/, SUB('mobilitaet', 'Parken')],
  [/spende/, SUB('geschenke', 'Spende')],
  [/(geschenk|geburtstag|smyths)/, SUB('geschenke', 'Geschenke & Feiern')],
  [/(baumarkt|hagebau|obi|bauhaus|farbe|schraube|schornstein|schloss|schließ)/, SUB('haus', 'Hauswartung')],
  [/(garten|rasenmäher|erde|mulch)/, SUB('haus', 'Garten')],
  [/(pflanz|blumen)/, SUB('haus', 'Pflanzen')],
  [/(ikea|rossmann|rossman|müller|dm\b)/, SUB('haus', 'Haushalt')],
  [/(therme|threme|tehreme|freibad|kletter|circus|zirkus|kino)/, SUB('freizeit', 'Aktivitäten')],
  [/(essen|asia|mcdonald|döner|pizza|kaffee|kaffe|café)/, SUB('freizeit', 'Essen gehen')],
  [/(apotheke|apotek|kreatin|massage)/, 'exp-gesundheit'],
  [/(handy|monitor|elektronik)/, 'exp-elektronik'],
  [/(jacke|hose|takko|schuhe|kleid)/, 'exp-kleidung'],
  [/(urlaub|flughafen|hotel|mietauto)/, 'exp-urlaub']
];

// ---------- Jahr erkennen ----------
export function guessYear(wb: Workbook, fileName?: string): number | null {
  const fromName = fileName?.match(/(20\d\d)/)?.[1];
  if (fromName) return Number(fromName);
  const jan = wb.sheet('JAN');
  const d = jan?.get(21, 4);
  if (typeof d === 'number') return Number(excelDate(d).slice(0, 4));
  return null;
}

export function looksLikeTemplate(wb: Workbook): boolean {
  return MONTH_SHEETS.every((m) => wb.sheet(m)) && !!wb.sheet('Kostenstruktur');
}

// ---------- Hauptfunktion ----------
export function analyzeWorkbook(wb: Workbook, year: number, mode: ImportMode, ctx: ImportContext): ImportResult {
  const warnings: string[] = [];
  const txs: DraftTx[] = [];
  const newCategories: ImportResult['newCategories'] = [];
  const newAccounts: ImportResult['newAccounts'] = [];
  const cats = new Map(ctx.categories.map((c) => [c.id, c]));
  const giro = ctx.budgetAcc;
  const tagesgeld = ctx.accounts.find((a) => a.kind === 'tagesgeld')?.id ?? giro;
  const depot = ctx.accounts.find((a) => a.kind === 'depot')?.id ?? giro;
  const src = (part: string) => `excel:${year}:${part}`;
  const idp = `imp:${year}`;
  const skippedMonths: Month[] = [];
  let unpaidBills = 0;

  const ensureCategory = (id: string, make: () => ImportResult['newCategories'][0]) => {
    if (!cats.has(id) && !newCategories.some((c) => c.id === id)) {
      const c = make();
      newCategories.push(c);
      cats.set(id, { ...c, updatedAt: '', deviceId: '' } as Category);
    }
    return id;
  };
  const findCatByName = (group: Category['group'], name: string) =>
    [...cats.values()].find((c) => c.group === group && norm(c.name) === norm(name))?.id;

  const expenseCat = (excelName: string): string => {
    const n = norm(excelName);
    let id = EXCEL_EXPENSE[n] ?? findCatByName('expense', excelName);
    if (id === 'exp-projekte') ensureCategory(id, () => ({ ...PROJECTS_CAT }));
    if (!id) {
      id = ensureCategory(`exp-${slug(excelName)}`, () => ({ id: `exp-${slug(excelName)}`, name: excelName, icon: '📦', color: '#8a93a3', group: 'expense', order: 50 }));
      warnings.push(`Neue Ausgabenkategorie „${excelName}“ angelegt (in der App nicht vorhanden).`);
    }
    if (!cats.has(id)) id = 'exp-sonstiges';
    return id;
  };
  const mainOf = (id: string) => cats.get(id)?.parentId ?? id;
  const incomeCat = (name: string): string => {
    const n = norm(name);
    if (/arbeit|gehalt|lohn/.test(n)) return 'inc-gehalt';
    if (/zins/.test(n)) return 'inc-zinsen';
    if (/neben/.test(n)) return 'inc-neben';
    if (/finanzamt|steuer/.test(n)) return 'inc-finanzamt';
    if (/^sonstige/.test(n)) return 'inc-sonstige';
    const found = findCatByName('income', name) ?? [...cats.values()].find((c) => c.group === 'income' && norm(c.name).split(' ')[0] === n.split(' ')[0])?.id;
    if (found) return found;
    const id = `inc-${slug(name)}`;
    ensureCategory(id, () => ({ id, name, icon: '➕', color: '#8a93a3', group: 'income', order: 50 }));
    warnings.push(`Neue Einkommensart „${name}“ angelegt.`);
    return id;
  };
  const recByName = (name: string) => ctx.recurring.find((r) => !r.deleted && similarName(r.name, name));
  const investAccount = () => {
    let acc = ctx.accounts.find((a) => a.id === 'acc-invest') ?? newAccounts.find((a) => a.id === 'acc-invest');
    if (!acc) {
      const a = { id: 'acc-invest', name: 'Investitionen (Haus & PV)', kind: 'depot' as const, order: 4, deleted: 0 as const };
      newAccounts.push(a);
      acc = a as Account;
    }
    return acc.id;
  };

  // Excel-Sollwerte je Monat (für Prüfbericht) und Ausgaben je Hauptkategorie (für Abgleich)
  const excelMonth = new Map<Month, MonthCheck['excel']>();
  const excelExpByMain = new Map<Month, Map<string, number>>();
  const importMonths: Month[] = [];

  MONTH_SHEETS.forEach((sheetName, i) => {
    const sh = wb.sheet(sheetName);
    if (!sh) return;
    const month = `${year}-${pad(i + 1)}`;
    if (ctx.startMonth && compareMonth(month, ctx.startMonth) >= 0) { skippedMonths.push(month); return; }
    const ex = { income: 0, bills: 0, expenses: 0, debts: 0, savings: 0, balance: 0 };

    // Einkommen (Zeilen 21–45: C Name, D Zahltag, H Ist)
    for (let r = 21; r <= 45; r++) {
      const name = text(sh.get(r, 3));
      const v = numOf(sh.get(r, 8));
      if (!name || !v) continue;
      ex.income += cents(v);
      const d = sh.get(r, 4);
      let date = `${month}-01`;
      if (typeof d === 'number') {
        const iso = excelDate(d);
        if (iso.slice(0, 7) === month) date = iso;
      }
      const base = { id: `${idp}:inc:${month}:${r}`, date, month, accountId: giro, source: src('einkommen'), deleted: 0 as const };
      if (/^tagesgeld$/i.test(name)) {
        // Entnahme aus dem Tagesgeld (2025 als „Einkommen“ gebucht) → Umbuchung
        txs.push({ ...base, kind: 'transfer', amount: cents(v), accountId: tagesgeld, toAccountId: giro, text: 'Entnahme Tagesgeld (aus Excel „Einkommen“)' });
        warnings.push(`${month}: „Tagesgeld“ unter Einkommen (${v.toFixed(2)} €) als Entnahme/Umbuchung übernommen.`);
      } else {
        const cat = incomeCat(name);
        txs.push({ ...base, kind: 'income', amount: cents(v), categoryId: cat, text: cats.get(cat)?.name !== name ? name : undefined });
      }
    }

    // Fixkosten (Zeilen 13–45: J Häkchen, K Name, P Ist). Wie in Excel zählen nur abgehakte.
    for (let r = 13; r <= 45; r++) {
      const name = text(sh.get(r, 11));
      const v = numOf(sh.get(r, 16));
      if (!name || !v) continue;
      if (sh.get(r, 10) !== true) { unpaidBills++; continue; }
      ex.bills += cents(v);
      const rec = recByName(name);
      txs.push({
        id: rec ? `rec:${rec.id}:${month}` : `${idp}:bill:${month}:${slug(name)}`,
        kind: 'bill', date: `${month}-01`, month, amount: cents(v), accountId: giro, paid: 1,
        categoryId: rec?.categoryId ?? billCategory(name), text: rec?.name ?? name, recurringId: rec?.id, source: src('fixkosten'), deleted: 0
      });
    }

    // Ausgaben-Summen je Kategorie (S Name, W Ist)
    const byMain = new Map<string, number>();
    const sumRows: { cat: string; name: string; v: number }[] = [];
    for (let r = 13; r <= 45; r++) {
      const name = text(sh.get(r, 19));
      const v = numOf(sh.get(r, 23));
      if (!name || !v) continue;
      ex.expenses += cents(v);
      const cat = expenseCat(name);
      byMain.set(mainOf(cat), (byMain.get(mainOf(cat)) ?? 0) + cents(v));
      sumRows.push({ cat, name, v });
    }
    excelExpByMain.set(month, byMain);
    if (mode === 'sums') {
      for (const s of sumRows) txs.push({ id: `${idp}:sum:${month}:${slug(s.name)}`, kind: 'expense', date: `${month}-28`, month, amount: cents(s.v), accountId: giro, categoryId: s.cat, text: `Monatssumme ${s.name} (Excel)`, source: src('ausgaben'), deleted: 0 });
    }

    // Schulden (Zeilen 13–25: Z Name, AE Ist) → Fixkosten „Raten & Schulden“
    for (let r = 13; r <= 25; r++) {
      const name = text(sh.get(r, 26));
      const v = numOf(sh.get(r, 31));
      if (!name || !v || /^total$/i.test(name)) continue;
      ex.debts += cents(v);
      const rec = recByName(name);
      txs.push({
        id: rec ? `rec:${rec.id}:${month}` : `${idp}:debt:${month}:${slug(name)}`,
        kind: 'bill', date: `${month}-01`, month, amount: cents(v), accountId: giro, paid: 1, categoryId: rec?.categoryId ?? 'bill-raten',
        text: rec?.name ?? name, recurringId: rec?.id, source: src('schulden'), deleted: 0
      });
    }

    // Ersparnisse (Zeilen 30–45: Z Name, AE Ist) → Umbuchungen
    for (let r = 30; r <= 45; r++) {
      const name = text(sh.get(r, 26));
      const v = numOf(sh.get(r, 31));
      if (!name || !v) continue;
      ex.savings += cents(v);
      const target = /tagesgeld|bankkonto|bargeld/i.test(name) ? tagesgeld : /invest|pv/i.test(name) ? investAccount() : depot;
      const out = v > 0;
      txs.push({
        id: `${idp}:save:${month}:${r}`, kind: 'transfer', date: `${month}-28`, month, amount: Math.abs(cents(v)),
        accountId: out ? giro : target, toAccountId: out ? target : giro, text: out ? `${name} (Monatsrest)` : `Entnahme ${name}`, source: src('ersparnisse'), deleted: 0
      });
      if (!out) warnings.push(`${month}: negative Ersparnis „${name}“ (${v.toFixed(2)} €) als Entnahme übernommen.`);
    }
    ex.balance = ex.income - ex.bills - ex.expenses - ex.debts - ex.savings;
    excelMonth.set(month, ex);
    if (ex.income || ex.bills || ex.expenses || ex.debts || ex.savings) importMonths.push(month);
  });

  // Einkaufsliste → Einzelkäufe
  let journalRows = 0, autoCategorized = 0;
  const journalByMain = new Map<Month, Map<string, number>>();
  if (mode === 'details') {
    const sh = wb.sheet('Kostenstruktur');
    if (sh) {
      const rules = [...ctx.merchants].filter((m) => !m.deleted).sort((a, b) => b.pattern.length - a.pattern.length);
      let last: string | null = null;
      let skippedLater = 0;
      for (let r = 1; r <= sh.maxRow; r++) {
        const bRaw = sh.getMerged(r, 2);
        const label = text(sh.get(r, 3));
        const amt = numOf(sh.get(r, 4));
        const bTxt = text(bRaw).toLowerCase();
        if ((MONTH_WORDS[bTxt] && !label) || (MONTH_WORDS[label.toLowerCase()] && amt === null)) continue;
        if (/^(datum|laden)/i.test(label)) continue;
        if (bTxt === 'info') { warnings.push(`Einkaufsliste Zeile ${r}: Sammelzeile „${label}“ (${amt ?? '?'} €) nicht als Einzelkauf übernommen.`); continue; }
        if (amt === null) { if (label) warnings.push(`Einkaufsliste Zeile ${r}: „${label}“ ohne lesbaren Betrag übersprungen.`); continue; }
        // Datum
        let date: string | null = null;
        if (typeof bRaw === 'number') date = excelDate(bRaw);
        else if (bTxt) {
          const m = /(\d{1,2})\s*[.,]+\s*(\d{1,2})\s*[.,\s]+\s*(\d{2,5})/.exec(bTxt);
          if (m) {
            const y = Number(m[3]);
            if (y !== year) warnings.push(`Einkaufsliste Zeile ${r}: Datum „${text(bRaw)}“ → Jahr ${year} angenommen.`);
            const dd = Number(m[1]), mm = Number(m[2]);
            if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) date = `${year}-${pad(mm)}-${pad(Math.min(dd, new Date(year, mm, 0).getDate()))}`;
          } else warnings.push(`Einkaufsliste Zeile ${r}: Datum „${text(bRaw)}“ nicht lesbar – vorheriges Datum verwendet.`);
        }
        if (date && last && Math.abs(new Date(date).getTime() - new Date(last).getTime()) > 25 * 864e5) {
          // Vermutlich Tippfehler: Datum passt nicht zur Reihenfolge der Liste → vorheriges Datum (Monat wie in Excel eingetragen)
          warnings.push(`Einkaufsliste Zeile ${r}: Datum ${date.split('-').reverse().join('.')} passt nicht zur Reihenfolge – ${last.split('-').reverse().join('.')} (Zeile davor) verwendet.`);
          date = null;
        }
        if (date) last = date;
        if (!last) { warnings.push(`Einkaufsliste Zeile ${r}: kein Datum – übersprungen.`); continue; }
        const month = last.slice(0, 7);
        if (!importMonths.includes(month)) { if (ctx.startMonth && compareMonth(month, ctx.startMonth) >= 0) skippedLater++; continue; }
        // Kategorie: Ladenregeln der App, dann eingebaute Muster
        const t = label.toLowerCase();
        let cat = rules.find((m) => t.includes(m.pattern))?.categoryId ?? FALLBACK_RULES.find(([re]) => re.test(t))?.[1];
        if (cat) autoCategorized++;
        if (!cat || !cats.has(cat)) cat = 'exp-sonstiges';
        let value = cents(amt);
        const rawAmt = text(sh.get(r, 4));
        if (/plus/i.test(rawAmt)) { value = -value; warnings.push(`Einkaufsliste Zeile ${r}: „${rawAmt}“ als Gutschrift/Erlös (−${amt.toFixed(2)} €) übernommen.`); }
        else if (/^=/.test(rawAmt)) warnings.push(`Einkaufsliste Zeile ${r}: Betrag „${rawAmt}“ als ${amt.toFixed(2)} € gelesen – bitte prüfen.`);
        // Einkaufstour = mehrere Läden mit gemeinsamem (verbundenem) Datum
        const anchor = sh.mergeAnchorRow(r, 2);
        journalRows++;
        txs.push({
          id: `${idp}:kauf:${r}`, kind: 'expense', date: last, month, amount: value, accountId: giro, categoryId: cat,
          merchant: label.length <= 22 ? label.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined, text: label.length > 22 ? label : undefined,
          tripId: anchor ? `trip:${year}:${anchor}` : undefined, source: src('einkaufsliste'), deleted: 0
        });
        const mm = journalByMain.get(month) ?? new Map<string, number>();
        mm.set(mainOf(cat), (mm.get(mainOf(cat)) ?? 0) + value);
        journalByMain.set(month, mm);
      }
      if (skippedLater) warnings.push(`${skippedLater} Einkäufe ab ${ctx.startMonth} nicht übernommen – diese Monate führt die App selbst.`);
    }
  }

  // Abgleich: Einzelkäufe je Hauptkategorie auf die Excel-Monatssummen bringen
  let corrections = 0, correctionVolume = 0;
  if (mode === 'details') {
    for (const month of importMonths) {
      const ex = excelExpByMain.get(month) ?? new Map();
      const jr = journalByMain.get(month) ?? new Map();
      for (const main of new Set([...ex.keys(), ...jr.keys()])) {
        const diff = (ex.get(main) ?? 0) - (jr.get(main) ?? 0);
        if (!diff) continue;
        corrections++;
        correctionVolume += Math.abs(diff);
        txs.push({ id: `${idp}:abgleich:${month}:${main}`, kind: 'expense', date: `${month}-28`, month, amount: diff, accountId: giro, categoryId: main, text: 'Abgleich mit Excel-Monatsblatt', source: src('abgleich'), deleted: 0 });
      }
    }
  }
  if (unpaidBills) warnings.push(`${unpaidBills} Fixkosten-Einträge waren in Excel nicht abgehakt und wurden – wie in Excel – nicht gezählt.`);

  // Prüfbericht: App-Werte aus den erzeugten Buchungen
  const months: MonthCheck[] = importMonths.map((month) => {
    const mt = txs.filter((t) => t.month === month);
    const sum = (f: (t: DraftTx) => boolean, sign: (t: DraftTx) => number = () => 1) => mt.filter(f).reduce((a, t) => a + sign(t) * t.amount, 0);
    const app = {
      income: sum((t) => t.kind === 'income') + sum((t) => t.source === src('einkommen') && t.kind === 'transfer'),
      bills: sum((t) => t.source === src('fixkosten')),
      expenses: sum((t) => t.kind === 'expense'),
      debts: sum((t) => t.source === src('schulden')),
      savings: sum((t) => t.source === src('ersparnisse'), (t) => (t.accountId === giro ? 1 : -1)),
      balance: 0
    };
    // „Verfügbar“ wie die App rechnet (Haushaltskonto)
    const inc = sum((t) => t.kind === 'income'), wd = sum((t) => t.kind === 'transfer' && t.toAccountId === giro && t.accountId !== giro);
    const out = sum((t) => t.kind === 'transfer' && t.accountId === giro && t.toAccountId !== giro);
    app.balance = inc + wd - sum((t) => t.kind === 'bill') - app.expenses - out;
    const ex = excelMonth.get(month)!;
    const ok = (['income', 'bills', 'expenses', 'debts', 'savings', 'balance'] as const).every((k) => ex[k] === app[k]);
    return { month, excel: ex, app, ok };
  });

  // Jahressummen je Hauptkategorie
  const catEx = new Map<string, number>(), catApp = new Map<string, number>();
  for (const [, m] of excelExpByMain) for (const [k, v] of m) catEx.set(k, (catEx.get(k) ?? 0) + v);
  for (const t of txs) if (t.kind === 'expense' && t.categoryId) catApp.set(mainOf(t.categoryId), (catApp.get(mainOf(t.categoryId)) ?? 0) + t.amount);
  const categoryTotals = [...new Set([...catEx.keys(), ...catApp.keys()])]
    .map((id) => ({ categoryId: id, label: cats.get(id)?.name ?? id, excel: catEx.get(id) ?? 0, app: catApp.get(id) ?? 0 }))
    .sort((a, b) => b.excel - a.excel);

  return { year, mode, txs, newCategories, newAccounts, months, categoryTotals, warnings, stats: { journalRows, autoCategorized, corrections, correctionVolume, skippedMonths, unpaidBills } };
}
