/** Tests der Vorschläge beim Erfassen – mit den neutralen Startdaten und erfundenen Buchungen */
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDb, type Category, type Transaction } from '../db/schema';
import { seedIfEmpty } from '../db/seed';
import { buildHistory, categoryForText, norm, suggestCategories, suggestTexts } from './suggest';

let ctx: { categories: Category[]; catById: Map<string, Category>; merchants: import('../db/schema').MerchantRule[]; txs: Transaction[] };

const tx = (id: string, text: string, categoryId: string, date = '2030-03-01', amount = 1000): Transaction =>
  ({ id, kind: 'expense', date, month: date.slice(0, 7), amount, accountId: 'acc-giro', categoryId, text, updatedAt: '', deviceId: '', deleted: 0 } as Transaction);

beforeAll(async () => {
  const db = useTestDb('suggest-test');
  await seedIfEmpty();
  const categories = await db.categories.toArray();
  ctx = { categories, catById: new Map(categories.map((c) => [c.id, c])), merchants: await db.merchants.toArray(), txs: [] };
});

const first = (q: string, history = buildHistory(ctx.txs)) => ctx.catById.get(suggestCategories(q, ctx, 'expense', history)[0]?.id ?? '')?.name;

describe('Kategorie-Vorschläge', () => {
  it('findet Unterkategorien über den Namen', () => {
    expect(first('Spende')).toBe('Spende');
    expect(first('tank')).toBe('Tanken');
    expect(first('bäck')).toBe('Bäcker');
    expect(first('baeck')).toBe('Bäcker');
  });
  it('findet Kategorien über Stichwörter', () => {
    expect(first('Kirche')).toBe('Spende');
    expect(first('Pizza')).toBe('Essen gehen');
    expect(first('Benzin')).toBe('Tanken');
    expect(first('Kino')).toBe('Unterhaltung');
  });
  it('lernt aus eigenen früheren Buchungen', () => {
    const spende = ctx.categories.find((c) => c.name === 'Spende')!.id;
    const history = buildHistory([tx('1', 'Bergwacht', spende), tx('2', 'Bergwacht', spende, '2030-04-01')]);
    expect(first('bergw', history)).toBe('Spende');
    expect(categoryForText('bergwacht', history, ctx.merchants)).toBe(spende);
  });
  it('liefert nichts bei leerer Eingabe und nichts Unpassendes', () => {
    expect(suggestCategories('', ctx, 'expense')).toEqual([]);
    expect(suggestCategories('xyzqq', ctx, 'expense')).toEqual([]);
  });
  it('Einnahmen-Kategorien getrennt von Ausgaben', () => {
    const hits = suggestCategories('Gehalt', ctx, 'income');
    expect(ctx.catById.get(hits[0].id)?.name).toBe('Arbeitseinkommen');
    expect(hits.every((h) => ctx.catById.get(h.id)?.group === 'income')).toBe(true);
  });
});

describe('Vorschläge für Beschreibung / Laden', () => {
  it('schlägt frühere Eingaben und Läden vor, häufige zuerst, mit Kategorie und letztem Betrag', () => {
    const lm = ctx.categories.find((c) => c.name === 'Supermarkt')!.id;
    const kl = ctx.categories.find((c) => c.name === 'Kleidung')!.id;
    const history = buildHistory([
      tx('1', 'Hofladen Huber', lm, '2030-01-02', 500), tx('2', 'Hofladen Huber', lm, '2030-02-02', 650),
      tx('3', 'Hosen-Shop', kl, '2030-01-05'), tx('4', 'Ausgleich März', lm)
    ]);
    const hits = suggestTexts('ho', history, ctx.merchants);
    expect(hits[0].text).toBe('Hofladen Huber');
    expect(hits[0].categoryId).toBe(lm);
    expect(hits[0].amount).toBe(650);
    expect(hits.some((h) => h.text === 'Hosen-Shop')).toBe(true);
    expect(suggestTexts('Ausgl', history, ctx.merchants)).toEqual([]); // Abgleich-/Ausgleichsbuchungen nicht vorschlagen
    expect(suggestTexts('lid', [], ctx.merchants)[0].text).toBe('Lidl'); // Läden-Regeln
  });
  it('häufigste Kategorie gewinnt', () => {
    const a = ctx.categories.find((c) => c.name === 'Supermarkt')!.id;
    const b = ctx.categories.find((c) => c.name === 'Haushalt')!.id;
    const h = buildHistory([tx('1', 'Markt X', a), tx('2', 'Markt X', a), tx('3', 'Markt X', b)]);
    expect(h[0].categoryId).toBe(a);
  });
  it('normalisiert Umlaute und Sonderzeichen', () => {
    expect(norm('Bäckerei Über-Groß!')).toBe('baeckerei ueber gross');
  });
});
