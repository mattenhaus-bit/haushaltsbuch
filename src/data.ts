import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Account, type Category, type MerchantRule, type Pot, type Recurring, type Transaction } from './db/schema';
import { budgetAccountId } from './lib/calc';

export interface AppData {
  accounts: Account[];
  categories: Category[];
  recurring: Recurring[];
  pots: Pot[];
  txs: Transaction[];
  merchants: MerchantRule[];
  settings: Record<string, unknown>;
  budgetAcc?: string;
  catById: Map<string, Category>;
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

/** Lädt alle Daten reaktiv. Bei einem Haushaltsbuch (einige tausend Buchungen) ist das schnell genug. */
export function useAppData(): AppData | undefined {
  return useLiveQuery(async () => {
    const [accounts, categories, recurring, pots, txs, merchants, settingsArr] = await Promise.all([
      db.accounts.toArray(), db.categories.toArray(), db.recurring.toArray(), db.pots.toArray(),
      db.transactions.toArray(), db.merchants.toArray(), db.settings.toArray()
    ]);
    const live = <T extends { deleted?: 0 | 1 }>(x: T[]) => x.filter((i) => !i.deleted);
    const cats = live(categories).sort(byOrder);
    const accs = live(accounts).sort(byOrder);
    return {
      accounts: accs,
      categories: cats,
      recurring: live(recurring).sort((a, b) => a.dueDay - b.dueDay),
      pots: live(pots).sort(byOrder),
      txs: live(txs),
      merchants: live(merchants).sort(byOrder),
      settings: Object.fromEntries(settingsArr.map((s) => [s.key, s.value])),
      budgetAcc: budgetAccountId(accs),
      catById: new Map(categories.map((c) => [c.id, c]))
    };
  });
}

export function catLabel(d: AppData, id?: string): string {
  if (!id) return 'Ohne Kategorie';
  const c = d.catById.get(id);
  if (!c) return 'Unbekannt';
  const p = c.parentId ? d.catById.get(c.parentId) : undefined;
  return p ? `${p.name} · ${c.name}` : c.name;
}

export function catIcon(d: AppData, id?: string): string {
  const c = id ? d.catById.get(id) : undefined;
  if (!c) return '•';
  if (c.icon) return c.icon;
  const p = c.parentId ? d.catById.get(c.parentId) : undefined;
  return p?.icon ?? '•';
}

const FALLBACK = '#8a93a3';
/** Farbe einer (Unter-)Kategorie = Farbe der Hauptkategorie */
export function catColor(d: AppData, id?: string): string {
  const c = id ? d.catById.get(id) : undefined;
  if (!c) return FALLBACK;
  if (c.color) return c.color;
  const p = c.parentId ? d.catById.get(c.parentId) : undefined;
  return p?.color ?? FALLBACK;
}

/** Hintergrund für Kategorie-Symbole (zarte Tönung der Kategoriefarbe) */
export function catTint(color: string): string {
  return `color-mix(in srgb, ${color} 18%, var(--surface))`;
}

export function mainCatId(d: AppData, id?: string): string | undefined {
  const c = id ? d.catById.get(id) : undefined;
  return c?.parentId ?? c?.id;
}

/** Kategorien nach Nutzung der letzten 90 Tage sortiert (für die Schnellwahl) */
export function topCategories(d: AppData, group: 'expense' | 'income', n = 6): string[] {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const counts = new Map<string, number>();
  for (const t of d.txs) {
    if (t.kind !== group || !t.categoryId || t.date < since) continue;
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => !d.catById.get(k)?.archived);
  const rest = d.categories.filter((c) => c.group === group && !c.archived && !c.parentId && !used.includes(c.id)).map((c) => c.id);
  return [...used, ...rest].slice(0, n);
}
