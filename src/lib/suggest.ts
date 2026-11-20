/**
 * Vorschläge beim Erfassen: passende Kategorien und bereits verwendete Beschreibungen/Läden.
 * Quellen: Kategorienamen, eingebaute Stichwörter, Läden-Regeln und die eigenen bisherigen Buchungen
 * (was man schon einmal eingegeben hat, lernt die App so automatisch mit).
 */
import type { Category, MerchantRule, Transaction } from '../db/schema';

/** Kleinbuchstaben, Umlaute vereinheitlicht, nur Buchstaben/Ziffern/Leerzeichen */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Eingebaute Stichwörter je Kategoriename (Haupt- oder Unterkategorie).
 * Greift auch für selbst angelegte Kategorien mit demselben Namen.
 */
const KEYWORDS: Record<string, string[]> = {
  lebensmittel: ['einkauf', 'essen', 'getraenke', 'markt', 'discounter', 'lebensmittel'],
  supermarkt: ['supermarkt', 'discounter', 'wocheneinkauf'],
  'bauer eier': ['eier', 'hofladen', 'bauer', 'milch', 'direktvermarkter'],
  baecker: ['brot', 'broetchen', 'semmel', 'brezen', 'kuchen', 'baeckerei', 'konditorei'],
  mobilitaet: ['auto', 'bahn', 'zug', 'bus', 'ticket', 'fahrt', 'taxi', 'maut', 'vignette'],
  tanken: ['benzin', 'diesel', 'sprit', 'tankstelle', 'super', 'e10', 'laden strom', 'ladesaeule'],
  auto: ['werkstatt', 'reifen', 'inspektion', 'tuev', 'oel', 'waschanlage', 'autowaesche', 'reparatur', 'ersatzteil'],
  parken: ['parkhaus', 'parkschein', 'parkplatz', 'parkgebuehr'],
  'haus garten': ['baumarkt', 'werkzeug', 'moebel', 'deko'],
  hauswartung: ['handwerker', 'reparatur', 'heizung', 'wartung', 'kaminkehrer', 'installateur'],
  garten: ['erde', 'duenger', 'rasen', 'gartencenter', 'samen'],
  pflanzen: ['blumen', 'pflanze', 'gaertnerei'],
  haushalt: ['putzmittel', 'drogerie', 'waschmittel', 'kuechen', 'geschirr', 'batterien', 'gluehbirne'],
  freizeit: ['hobby', 'freizeit'],
  aktivitaeten: ['eintritt', 'museum', 'zoo', 'schwimmbad', 'therme', 'ausflug', 'kletter', 'ski', 'lift'],
  unterhaltung: ['kino', 'buch', 'spiel', 'konzert', 'theater', 'film', 'musik', 'zeitschrift'],
  'ausgehen freunde': ['bar', 'kneipe', 'party', 'feier', 'fest', 'disco', 'club'],
  'essen gehen': ['restaurant', 'pizza', 'doener', 'imbiss', 'cafe', 'kaffee', 'mittagessen', 'lieferdienst', 'burger', 'eis', 'wirtshaus', 'kantine'],
  'geschenke spenden': ['geschenk', 'spende'],
  'geschenke feiern': ['geschenk', 'geburtstag', 'hochzeit', 'taufe', 'weihnachten', 'mitbringsel', 'gutschein'],
  spende: ['spende', 'spenden', 'kirche', 'kollekte', 'verein', 'hilfe', 'charity', 'rotes kreuz', 'unicef', 'tierheim', 'sammlung'],
  'gesundheit sport': ['apotheke', 'arzt', 'medikament', 'zahnarzt', 'brille', 'fitness', 'sport', 'physio', 'massage', 'friseur'],
  kleidung: ['schuhe', 'hose', 'jacke', 'shirt', 'mode', 'kleid', 'socken'],
  elektronik: ['handy', 'computer', 'kabel', 'laptop', 'tablet', 'zubehoer', 'technik', 'smartphone'],
  urlaub: ['hotel', 'reise', 'flug', 'ferienwohnung', 'urlaub', 'camping', 'booking'],
  sonstiges: ['sonstiges', 'diverses'],
  arbeitseinkommen: ['gehalt', 'lohn', 'arbeit'],
  nebenbeschaeftigungen: ['nebenjob', 'minijob', 'honorar'],
  zinsen: ['zinsen', 'dividende', 'ertrag'],
  finanzamt: ['steuer', 'erstattung', 'steuererstattung'],
  'sonstige einnahmen': ['verkauf', 'kleinanzeigen', 'geschenk', 'rueckzahlung']
};

export interface CatHit { id: string; reason?: string }

interface Ctx { categories: Category[]; catById: Map<string, Category>; merchants: MerchantRule[]; txs: Transaction[] }

const words = (s: string) => norm(s).split(' ').filter(Boolean);
/** Passt die Eingabe zu einem Text? (jedes eingegebene Wort ist Wortanfang im Text, ab 3 Zeichen auch innerhalb) */
function matches(query: string, target: string): number {
  const q = words(query);
  if (!q.length) return 0;
  const t = norm(target);
  const tw = t.split(' ');
  let score = 0;
  for (const w of q) {
    if (tw.some((x) => x === w)) score += 3;
    else if (tw.some((x) => x.startsWith(w))) score += 2;
    else if (w.length >= 3 && t.includes(w)) score += 1;
    else return 0;
  }
  return score;
}

/** Bisherige Beschreibungen/Läden mit ihrer häufigsten Kategorie */
export interface HistoryItem { text: string; categoryId?: string; count: number; last: string; amount?: number }

export function buildHistory(txs: Transaction[], kind: 'expense' | 'income' = 'expense'): HistoryItem[] {
  const map = new Map<string, { text: string; cats: Map<string, number>; count: number; last: string; amount?: number }>();
  for (const t of txs) {
    if (t.deleted || t.kind !== kind) continue;
    const label = (t.merchant || t.text || '').trim();
    if (!label || label.length < 2 || /^(abgleich|ausgleich)\b/i.test(label)) continue;
    const key = norm(label);
    if (!key) continue;
    let e = map.get(key);
    if (!e) { e = { text: label, cats: new Map(), count: 0, last: '' }; map.set(key, e); }
    e.count++;
    if (t.date >= e.last) { e.last = t.date; e.text = label; e.amount = t.amount; }
    if (t.categoryId) e.cats.set(t.categoryId, (e.cats.get(t.categoryId) ?? 0) + 1);
  }
  return [...map.values()].map((e) => ({
    text: e.text, count: e.count, last: e.last, amount: e.amount,
    categoryId: [...e.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }));
}

/** Vorschläge für Beschreibung / Laden beim Tippen */
export function suggestTexts(query: string, history: HistoryItem[], merchants: MerchantRule[], n = 6): HistoryItem[] {
  if (norm(query).length < 1) return [];
  const pool = new Map<string, HistoryItem & { score: number }>();
  for (const h of history) {
    const m = matches(query, h.text);
    if (m) pool.set(norm(h.text), { ...h, score: m * 10 + Math.min(h.count, 30) + (h.last >= recent() ? 5 : 0) });
  }
  for (const r of merchants) {
    const m = Math.max(matches(query, r.label), matches(query, r.pattern));
    const key = norm(r.label);
    if (m && !pool.has(key)) pool.set(key, { text: r.label, categoryId: r.categoryId, count: 0, last: '', score: m * 10 + (r.quick ? 3 : 0) });
  }
  const q = norm(query);
  return [...pool.values()]
    .filter((x) => norm(x.text) !== q)
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, n);
}
function recent() {
  return new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
}

/** Pfadname einer Kategorie, z. B. „Geschenke & Spenden › Spende“ */
export function catPath(c: Category | undefined, catById: Map<string, Category>): string {
  if (!c) return '';
  const parent = c.parentId ? catById.get(c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Kategorie-Vorschläge zur Eingabe (Name, Stichwort, Laden-Regel, eigene frühere Buchungen) */
export function suggestCategories(query: string, ctx: Ctx, group: 'expense' | 'income' | 'bill', history?: HistoryItem[], n = 6): CatHit[] {
  if (!norm(query)) return [];
  const score = new Map<string, { s: number; reason?: string }>();
  const add = (id: string | undefined, s: number, reason?: string) => {
    if (!id) return;
    const c = ctx.catById.get(id);
    if (!c || c.archived || c.deleted || c.group !== group) return;
    const cur = score.get(id);
    if (!cur || s > cur.s) score.set(id, { s, reason: reason ?? cur?.reason });
  };
  for (const c of ctx.categories) {
    if (c.group !== group || c.archived || c.deleted) continue;
    const parent = c.parentId ? ctx.catById.get(c.parentId) : undefined;
    const m = Math.max(matches(query, c.name), parent ? matches(query, `${parent.name} ${c.name}`) : 0);
    if (m) add(c.id, 100 + m * 10 + (c.parentId ? 1 : 0));
    for (const k of KEYWORDS[norm(c.name)] ?? []) {
      const km = matches(query, k);
      if (km) add(c.id, 80 + km * 5 + (c.parentId ? 2 : 0), k);
    }
  }
  for (const r of ctx.merchants) {
    const m = Math.max(matches(query, r.label), matches(query, r.pattern));
    if (m) add(r.categoryId, 70 + m * 5, r.label);
  }
  for (const h of history ?? []) {
    const m = matches(query, h.text);
    if (m && h.categoryId) add(h.categoryId, 60 + m * 5 + Math.min(h.count, 20), h.text);
  }
  return [...score.entries()]
    .sort((a, b) => b[1].s - a[1].s)
    .slice(0, n)
    .map(([id, v]) => ({ id, reason: v.reason }));
}

/** Kategorie zu einer Beschreibung/einem Laden: zuerst eigene frühere Buchungen, dann Läden-Regeln */
export function categoryForText(text: string, history: HistoryItem[], merchants: MerchantRule[]): string | undefined {
  const key = norm(text);
  if (!key) return undefined;
  const exact = history.find((h) => norm(h.text) === key && h.categoryId);
  if (exact) return exact.categoryId;
  const t = text.toLowerCase();
  const rule = [...merchants].sort((a, b) => b.pattern.length - a.pattern.length).find((r) => t.includes(r.pattern));
  return rule?.categoryId;
}
