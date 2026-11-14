/**
 * Neutrale Startdaten für eine neue, leere App: Konten, Kategorien und allgemein bekannte Läden.
 * Enthält bewusst KEINE persönlichen Daten (keine Beträge, Verträge, Namen).
 * Persönliche Fixkosten, Töpfe usw. kommen über „Mehr → Startdaten / Daten importieren“
 * aus einer privaten Datei (Ordner privat/, wird nie hochgeladen) oder über den Excel-Import.
 */
import { db, type Account, type Category, type MerchantRule } from './schema';
import { deviceId, nowIso } from './meta';
import { currentMonth } from '../lib/dates';
type Seed<T> = Omit<T, 'updatedAt' | 'deviceId'>;

const accounts: Seed<Account>[] = [
  { id: 'acc-giro', name: 'Girokonto', kind: 'giro', isBudget: 1, order: 1 },
  { id: 'acc-tagesgeld', name: 'Tagesgeld', kind: 'tagesgeld', order: 2 },
  { id: 'acc-depot', name: 'Broker / Depot', kind: 'depot', order: 3 }
];

// Vereinfachte Ausgaben-Kategorien (Hauptkategorie + optionale Unterkategorien)
// Farben aus der validierten Kategorie-Palette (feste Zuordnung) + zwei neutrale Töne
const expenseTree: [string, string, string, string, string[]][] = [
  ['lebensmittel', 'Lebensmittel', '🛒', '#1baf7a', ['Supermarkt', 'Bauer / Eier', 'Bäcker']],
  ['mobilitaet', 'Mobilität', '⛽', '#eb6834', ['Tanken', 'Auto', 'Parken']],
  ['haus', 'Haus & Garten', '🏡', '#2f8f3a', ['Hauswartung', 'Garten', 'Pflanzen', 'Haushalt']],
  ['freizeit', 'Freizeit', '🎟️', '#6250d6', ['Aktivitäten', 'Unterhaltung', 'Ausgehen / Freunde', 'Essen gehen']],
  ['geschenke', 'Geschenke & Spenden', '🎁', '#e87ba4', ['Geschenke & Feiern', 'Spende']],
  ['gesundheit', 'Gesundheit & Sport', '💪', '#e34948', []],
  ['kleidung', 'Kleidung', '👕', '#eda100', []],
  ['elektronik', 'Elektronik', '💻', '#2a78d6', []],
  ['urlaub', 'Urlaub', '🏖️', '#4aa3b8', []],
  ['sonstiges', 'Sonstiges', '📦', '#8a93a3', []]
];

const incomeCats: [string, string, string, string][] = [
  ['inc-gehalt', 'Arbeitseinkommen', '💼', '#2a78d6'],
  ['inc-neben', 'Nebenbeschäftigungen', '🧰', '#6250d6'],
  ['inc-zinsen', 'Zinsen', '📈', '#eda100'],
  ['inc-finanzamt', 'Finanzamt', '🧾', '#eb6834'],
  ['inc-sonstige', 'Sonstige Einnahmen', '➕', '#8a93a3']
];

const billCats: [string, string, string, string][] = [
  ['bill-wohnen', 'Wohnen & Energie', '💡', '#eb6834'],
  ['bill-abos', 'Abos & Kommunikation', '📱', '#2a78d6'],
  ['bill-familie', 'Familie', '👨‍👧', '#e87ba4'],
  ['bill-versicherung', 'Versicherungen', '🛡️', '#1baf7a'],
  ['bill-raten', 'Raten & Schulden', '💳', '#e34948'],
  ['bill-ruecklagen', 'Rücklagen (Töpfe)', '🫙', '#eda100']
];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '');
}

function buildCategories(): Seed<Category>[] {
  const out: Seed<Category>[] = [];
  expenseTree.forEach(([id, name, icon, color, subs], i) => {
    out.push({ id: `exp-${id}`, name, icon, color, group: 'expense', order: i });
    subs.forEach((s, j) => out.push({ id: `exp-${id}-${slug(s)}`, name: s, group: 'expense', parentId: `exp-${id}`, order: j }));
  });
  incomeCats.forEach(([id, name, icon, color], i) => out.push({ id, name, icon, color, group: 'income', order: i }));
  billCats.forEach(([id, name, icon, color], i) => out.push({ id, name, icon, color, group: 'bill', order: i }));
  return out;
}

const SUB = (main: string, sub: string) => `exp-${main}-${slug(sub)}`;

const merchants: Seed<MerchantRule>[] = (
  [
    ['aldi', 'Aldi', SUB('lebensmittel', 'Supermarkt'), 1],
    ['lidl', 'Lidl', SUB('lebensmittel', 'Supermarkt'), 1],
    ['penny', 'Penny', SUB('lebensmittel', 'Supermarkt'), 1],
    ['netto', 'Netto', SUB('lebensmittel', 'Supermarkt'), 1],
    ['edeka', 'Edeka', SUB('lebensmittel', 'Supermarkt'), 1],
    ['rewe', 'Rewe', SUB('lebensmittel', 'Supermarkt'), 0],
    ['bäcker', 'Bäcker', SUB('lebensmittel', 'Bäcker'), 0],
    ['aral', 'Aral', SUB('mobilitaet', 'Tanken'), 0],
    ['esso', 'Esso', SUB('mobilitaet', 'Tanken'), 0],
    ['tanken', 'Tanken', SUB('mobilitaet', 'Tanken'), 0],
    ['parken', 'Parken', SUB('mobilitaet', 'Parken'), 0],
    ['hagebau', 'Hagebaumarkt', SUB('haus', 'Hauswartung'), 1],
    ['ikea', 'IKEA', SUB('haus', 'Haushalt'), 0],
    ['amazon', 'Amazon', 'exp-sonstiges', 1],
    ['rossmann', 'Rossmann', SUB('haus', 'Haushalt'), 0],
    ['müller', 'Müller', SUB('haus', 'Haushalt'), 0],
    ['apotheke', 'Apotheke', 'exp-gesundheit', 0],
    ['therme', 'Therme', SUB('freizeit', 'Aktivitäten'), 0],
    ['mcdonald', "McDonald's", SUB('freizeit', 'Essen gehen'), 0]
  ] as [string, string, string, number][]
).map(([pattern, label, categoryId, quick], i) => ({ id: `mr-${slug(pattern)}`, pattern, label, categoryId, quick: quick as 0 | 1, order: i }));

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  incomeShiftDay: 25, // Einnahmen ab dem 25. zählen für den Folgemonat
  theme: 'system',
  startMonth: null // erster Monat, ab dem Fixkosten automatisch angelegt werden
};

export async function seedIfEmpty(): Promise<boolean> {
  if ((await db.accounts.count()) > 0) return false;
  const dev = await deviceId();
  const meta = { updatedAt: nowIso(), deviceId: dev, deleted: 0 as const };
  await db.transaction('rw', [db.accounts, db.categories, db.merchants, db.settings], async () => {
    await db.accounts.bulkPut(accounts.map((a) => ({ ...a, ...meta })));
    await db.categories.bulkPut(buildCategories().map((c) => ({ ...c, ...meta })));
    await db.merchants.bulkPut(merchants.map((m) => ({ ...m, ...meta })));
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await db.settings.put({ key, value: key === 'startMonth' ? currentMonth() : value });
    }
  });
  return true;
}
