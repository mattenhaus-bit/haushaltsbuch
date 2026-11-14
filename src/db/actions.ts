import { db, GENESIS, SYNC_TABLES, type Category, type MerchantRule, type Pot, type Recurring, type Transaction } from './schema';
import { alive, deviceId, newId, nowIso, stamp, stampSync } from './meta';
import { budgetMonthForIncome, compareMonth, dayInMonth, monthOf, type Day, type Month } from '../lib/dates';
import { isActive, isDue, potRate, potTxId, priceFor, recurringTxId } from '../lib/recurring';
import type { Cents } from '../lib/money';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return (s?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

async function budgetAccount(): Promise<string> {
  const accs = (await db.accounts.toArray()).filter(alive);
  return (accs.find((a) => a.isBudget) ?? accs.find((a) => a.kind === 'giro') ?? accs[0]).id;
}

/** Automatisch erzeugte Instanzen bekommen den GENESIS-Zeitstempel: jedes Gerät erzeugt sie identisch,
 *  und jede echte Änderung (z. B. Abhaken auf dem iPhone) gewinnt beim Synchronisieren. */
const genesis = <T extends { updatedAt: string }>(x: T): T => ({ ...x, updatedAt: GENESIS });

/**
 * Legt für einen Monat alle fälligen Fixkosten und Topf-Raten als offene Buchungen an.
 * Bereits vorhandene (auch gelöschte) Instanzen werden nicht neu erzeugt.
 * Erst ab dem Startmonat der App – frühere Monate kommen später über den Excel-Import.
 */
export async function ensureMonth(m: Month): Promise<number> {
  const start = await getSetting<Month | null>('startMonth', null);
  if (start && compareMonth(m, start) < 0) return 0;
  const giro = await budgetAccount();
  const recs = (await db.recurring.toArray()).filter(alive);
  const pots = (await db.pots.toArray()).filter((p) => alive(p) && !p.archived);
  const created: Transaction[] = [];

  for (const r of recs) {
    if (!isDue(r, m)) continue;
    const id = recurringTxId(r.id, m);
    if (await db.transactions.get(id)) continue;
    created.push(
      genesis(await stamp<Transaction>({
        id, kind: 'bill', date: dayInMonth(m, r.dueDay), month: m, amount: priceFor(r, m),
        accountId: giro, categoryId: r.categoryId, text: r.name, recurringId: r.id, paid: 0
      }))
    );
  }
  for (const p of pots) {
    if (!isActive(p, m)) continue;
    const id = potTxId(p.id, m);
    if (await db.transactions.get(id)) continue;
    created.push(
      genesis(await stamp<Transaction>({
        id, kind: 'bill', date: dayInMonth(m, 1), month: m, amount: potRate(p), accountId: giro,
        toAccountId: p.accountId, categoryId: 'bill-ruecklagen', text: `Rücklage ${p.name}`, potId: p.id, paid: 0
      }))
    );
  }
  if (created.length) await db.transactions.bulkPut(created);
  return created.length;
}

export async function categorizeMerchant(text: string): Promise<string | undefined> {
  const t = text.toLowerCase();
  const rules = (await db.merchants.toArray()).filter(alive).sort((a, b) => b.pattern.length - a.pattern.length);
  return rules.find((r) => t.includes(r.pattern))?.categoryId;
}

export interface ExpenseInput {
  amount: Cents; categoryId?: string; date: Day; text?: string; merchant?: string; potId?: string; tripId?: string;
}

async function expenseTx(e: ExpenseInput): Promise<Transaction> {
  let accountId = await budgetAccount();
  if (e.potId) {
    const pot = await db.pots.get(e.potId);
    if (pot) accountId = pot.accountId;
  }
  return stamp<Transaction>({
    kind: 'expense', date: e.date, month: monthOf(e.date), amount: e.amount, accountId,
    categoryId: e.categoryId, text: e.text?.trim() || undefined, merchant: e.merchant?.trim() || undefined,
    potId: e.potId || undefined, tripId: e.tripId
  });
}

export async function addExpense(e: ExpenseInput) {
  const tx = await expenseTx(e);
  await db.transactions.put(tx);
  return tx.id;
}

/** Einkaufstour: mehrere Läden mit gemeinsamem Datum (ersetzt die „Sammelsumme“ aus Excel) */
export async function addTrip(date: Day, rows: { merchant: string; amount: Cents; categoryId?: string; text?: string }[]) {
  const tripId = rows.length > 1 ? newId() : undefined;
  const txs: Transaction[] = [];
  for (const r of rows) {
    const categoryId = r.categoryId ?? (await categorizeMerchant(r.merchant)) ?? 'exp-sonstiges';
    txs.push(await expenseTx({ amount: r.amount, date, merchant: r.merchant, text: r.text, categoryId, tripId }));
  }
  await db.transactions.bulkPut(txs);
  return txs.length;
}

export async function addIncome(i: { amount: Cents; categoryId: string; date: Day; text?: string; month?: Month }) {
  const shift = await getSetting<number>('incomeShiftDay', 25);
  const tx = await stamp<Transaction>({
    kind: 'income', date: i.date, month: i.month ?? budgetMonthForIncome(i.date, shift), amount: i.amount,
    accountId: await budgetAccount(), categoryId: i.categoryId, text: i.text?.trim() || undefined
  });
  await db.transactions.put(tx);
  return tx.id;
}

export async function addTransfer(t: { from: string; to: string; amount: Cents; date: Day; text?: string; potId?: string; month?: Month }) {
  const tx = await stamp<Transaction>({
    kind: 'transfer', date: t.date, month: t.month ?? monthOf(t.date), amount: t.amount, accountId: t.from,
    toAccountId: t.to, text: t.text?.trim() || undefined, potId: t.potId || undefined
  });
  await db.transactions.put(tx);
  return tx.id;
}

export async function updateTx(id: string, patch: Partial<Transaction>) {
  const cur = await db.transactions.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  // Budgetmonat folgt dem Datum – außer bei Einnahmen (eigener Budgetmonat) und Fixkosten (Fälligkeitsmonat)
  if (patch.date && !patch.month && (cur.kind === 'expense' || cur.kind === 'transfer')) next.month = monthOf(patch.date);
  await db.transactions.put(await stamp(next));
}

export async function deleteTx(id: string) {
  await updateTx(id, { deleted: 1 });
}

export async function restoreTx(id: string) {
  await updateTx(id, { deleted: 0 });
}

export async function togglePaid(id: string) {
  const cur = await db.transactions.get(id);
  if (cur) await updateTx(id, { paid: cur.paid ? 0 : 1 });
}

// ---------- Stammdaten ----------
export async function saveCategory(c: Partial<Category> & Pick<Category, 'name' | 'group'>) {
  const prev = c.id ? await db.categories.get(c.id) : undefined;
  const all = await db.categories.where('group').equals(c.group).count();
  await db.categories.put(await stamp<Category>({ order: all, ...prev, ...c } as Category));
}

/** Kategorie A in B zusammenführen: alle Verweise (Buchungen, Unterkategorien, Fixkosten, Pläne, Läden) umhängen, A archivieren */
export async function mergeCategory(fromId: string, toId: string) {
  if (fromId === toId) return;
  const dev = await deviceId();
  // Innerhalb der Transaktion nur Datenbank-Operationen (stampSync statt stamp)
  await db.transaction('rw', [db.transactions, db.categories, db.recurring, db.budgets, db.merchants], async () => {
    const txs = await db.transactions.where('categoryId').equals(fromId).toArray();
    await db.transactions.bulkPut(txs.map((t) => stampSync({ ...t, categoryId: toId }, dev)));
    const subs = await db.categories.where('parentId').equals(fromId).toArray();
    await db.categories.bulkPut(subs.map((c) => stampSync({ ...c, parentId: toId }, dev)));
    const recs = (await db.recurring.toArray()).filter((r) => r.categoryId === fromId);
    await db.recurring.bulkPut(recs.map((r) => stampSync({ ...r, categoryId: toId }, dev)));
    const rules = (await db.merchants.toArray()).filter((m) => m.categoryId === fromId);
    await db.merchants.bulkPut(rules.map((m) => stampSync({ ...m, categoryId: toId }, dev)));
    // Pläne: in Zielkategorie zusammenrechnen
    for (const bud of await db.budgets.toArray()) {
      if (bud.categoryId !== fromId || bud.deleted) continue;
      const target = (await db.budgets.where('[month+categoryId]').equals([bud.month, toId]).toArray()).find((x) => !x.deleted);
      if (target) {
        await db.budgets.put(stampSync({ ...target, plan: target.plan + bud.plan }, dev));
        await db.budgets.put(stampSync({ ...bud, deleted: 1 }, dev));
      } else {
        await db.budgets.put(stampSync({ ...bud, categoryId: toId }, dev));
      }
    }
    const from = await db.categories.get(fromId);
    if (from) await db.categories.put(stampSync({ ...from, archived: 1 }, dev));
  });
}

export async function saveRecurring(r: Partial<Recurring> & Pick<Recurring, 'name' | 'categoryId' | 'interval' | 'dueDay' | 'start' | 'prices'>) {
  const prev = r.id ? await db.recurring.get(r.id) : undefined;
  await db.recurring.put(await stamp<Recurring>({ ...prev, ...r } as Recurring));
  await refreshOpenInstances(r.id);
}

/** Preisänderung ab Monat: Historie bleibt, offene künftige Buchungen werden angepasst */
export async function changePrice(recId: string, from: Month, amount: Cents) {
  const r = await db.recurring.get(recId);
  if (!r) return;
  const prices = r.prices.filter((p) => p.from !== from).concat({ from, amount });
  await db.recurring.put(await stamp({ ...r, prices }));
  await refreshOpenInstances(recId);
}

/** Offene (nicht abgehakte) Instanzen an geänderte Vorlage anpassen; nicht mehr fällige entfernen */
async function refreshOpenInstances(recId?: string) {
  if (!recId) return;
  const r = await db.recurring.get(recId);
  if (!r) return;
  const txs = await db.transactions.where('recurringId').equals(recId).toArray();
  for (const t of txs) {
    if (t.paid || t.deleted) continue;
    if (r.deleted || !isDue(r, t.month)) {
      await db.transactions.put(await stamp({ ...t, deleted: 1 }));
    } else {
      const amount = priceFor(r, t.month);
      if (amount !== t.amount || t.text !== r.name || t.categoryId !== r.categoryId)
        await db.transactions.put(await stamp({ ...t, amount, text: r.name, categoryId: r.categoryId, date: dayInMonth(t.month, r.dueDay) }));
    }
  }
}

export async function deleteRecurring(recId: string) {
  const r = await db.recurring.get(recId);
  if (!r) return;
  await db.recurring.put(await stamp({ ...r, deleted: 1 }));
  await refreshOpenInstances(recId);
}

export async function savePot(p: Partial<Pot> & Pick<Pot, 'name' | 'yearlyAmount' | 'dueMonths' | 'accountId' | 'start'>) {
  const prev = p.id ? await db.pots.get(p.id) : undefined;
  const count = await db.pots.count();
  const pot = await stamp<Pot>({ openingBalance: 0, order: count, ...prev, ...p } as Pot);
  await db.pots.put(pot);
  // offene Raten aktualisieren
  const txs = await db.transactions.where('potId').equals(pot.id).toArray();
  for (const t of txs) {
    if (t.kind !== 'bill' || t.paid || t.deleted) continue;
    if (pot.archived || pot.deleted) await db.transactions.put(await stamp({ ...t, deleted: 1 }));
    else if (t.amount !== potRate(pot)) await db.transactions.put(await stamp({ ...t, amount: potRate(pot), text: `Rücklage ${pot.name}` }));
  }
}

export async function saveMerchant(m: Partial<MerchantRule> & Pick<MerchantRule, 'pattern' | 'label' | 'categoryId'>) {
  const prev = m.id ? await db.merchants.get(m.id) : undefined;
  const count = await db.merchants.count();
  await db.merchants.put(await stamp<MerchantRule>({ order: count, quick: 1, ...prev, ...m, pattern: m.pattern.toLowerCase().trim() } as MerchantRule));
}

// ---------- Backup ----------
const TABLES = ['accounts', 'categories', 'recurring', 'pots', 'transactions', 'budgets', 'merchants', 'settings'] as const;
/** Gerätebezogene Einstellungen, die nie in eine Sicherung gehören bzw. beim Wiederherstellen erhalten bleiben */
const isDeviceSetting = (key: string) => key === 'deviceId' || key.startsWith('sync:') || key.startsWith('backup:');

export async function exportBackup(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  data.settings = (data.settings as { key: string }[]).filter((s) => !isDeviceSetting(s.key));
  return JSON.stringify({ app: 'haushaltsbuch', version: 1, exportedAt: new Date().toISOString(), data }, null, 1);
}

/**
 * Ersetzt den Datenbestand durch die angegebenen Datensätze – synchronisationsfest:
 * Alle Datensätze werden als neue Änderung dieses Geräts gestempelt, nicht enthaltene werden
 * als gelöscht markiert. So übernehmen auch die anderen Geräte den wiederhergestellten Stand.
 */
export async function replaceAllData(data: Record<string, unknown[] | undefined>) {
  const dev = await deviceId();
  const now = nowIso();
  const tables = SYNC_TABLES.map((t) => db.table(t));
  await db.transaction('rw', [...tables, db.settings], async () => {
    for (const t of SYNC_TABLES) {
      const rows = ((data[t] ?? []) as { id?: string }[]).filter((r) => r && typeof r.id === 'string');
      const keep = new Set(rows.map((r) => r.id));
      const gone = (await db.table(t).toArray()).filter((r: { id: string }) => !keep.has(r.id));
      await db.table(t).bulkPut([
        ...rows.map((r) => ({ deleted: 0, ...r, updatedAt: now, deviceId: dev })),
        ...gone.map((r: object) => ({ ...r, deleted: 1, updatedAt: now, deviceId: dev }))
      ]);
    }
    if (data.settings) {
      for (const s of await db.settings.toArray()) if (!isDeviceSetting(s.key)) await db.settings.delete(s.key);
      await db.settings.bulkPut((data.settings as { key: string; value: unknown }[]).filter((s) => s && typeof s.key === 'string' && !isDeviceSetting(s.key)));
    }
  });
}

/**
 * Fügt Datensätze aus einer Datei hinzu bzw. aktualisiert sie (gleiche ID = überschreiben),
 * ohne andere Daten zu löschen. Für die private Startdatei (Fixkosten, Töpfe …).
 * Einstellungen werden dabei nicht übernommen (sind gerätebezogen).
 */
export async function mergeImport(json: string): Promise<Record<string, number>> {
  const parsed = JSON.parse(json);
  if (parsed?.app !== 'haushaltsbuch' || !parsed.data) throw new Error('Keine gültige Haushaltsbuch-Datei');
  const counts: Record<string, number> = {};
  const tables = TABLES.filter((t) => t !== 'settings');
  const dev = await deviceId();
  const now = nowIso();
  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const t of tables) {
      const rows = (parsed.data[t] ?? []) as { id?: string }[];
      // als Änderung dieses Geräts stempeln, damit die Daten an die anderen Geräte gehen
      const valid = rows.filter((r) => r && typeof r.id === 'string').map((r) => ({ deleted: 0, ...r, updatedAt: now, deviceId: dev }));
      if (valid.length) await db.table(t).bulkPut(valid);
      if (valid.length) counts[t] = valid.length;
    }
  });
  await ensureMonth((await import('../lib/dates')).currentMonth());
  return counts;
}

/** Ersetzt alle Daten durch das Backup (vorher prüfen!) */
export async function importBackup(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.app !== 'haushaltsbuch' || !parsed.data) throw new Error('Keine gültige Haushaltsbuch-Sicherung');
  await replaceAllData(parsed.data);
}
