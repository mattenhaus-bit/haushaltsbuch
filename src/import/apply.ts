/**
 * Übernimmt ein geprüftes Import-Ergebnis in die Datenbank – oder nimmt einen Import wieder heraus.
 * Vor jeder Übernahme wird automatisch eine vollständige Sicherung gespeichert.
 */
import { db, type Account, type Category, type Transaction } from '../db/schema';
import { deviceId, stamp, stampSync } from '../db/meta';
import { exportBackup, getSetting, setSetting } from '../db/actions';
import type { ImportResult } from './excel';

export interface ImportLogEntry { year: number; mode: string; at: string; count: number; file?: string }

export async function importLog(): Promise<ImportLogEntry[]> {
  return getSetting<ImportLogEntry[]>('imports', []);
}

/** Letzte automatische Sicherung vor einem Import (lokal auf diesem Gerät) */
export async function lastPreImportBackup(): Promise<{ at: string; json: string } | null> {
  return getSetting<{ at: string; json: string } | null>('backup:vorImport', null);
}

export async function applyImport(r: ImportResult, fileName?: string): Promise<number> {
  // 1) Sicherung des aktuellen Stands
  await setSetting('backup:vorImport', { at: new Date().toISOString(), json: await exportBackup() });

  const source = `excel:${r.year}:`;
  const newIds = new Set(r.txs.map((t) => t.id));
  const dev = await deviceId();
  // Innerhalb der Transaktion nur Datenbank-Operationen (keine fremden Promises), daher stampSync
  await db.transaction('rw', [db.transactions, db.categories, db.accounts], async () => {
    for (const c of r.newCategories) if (!(await db.categories.get(c.id))) await db.categories.put(stampSync<Category>(c as Category, dev));
    for (const a of r.newAccounts) if (!(await db.accounts.get(a.id))) await db.accounts.put(stampSync<Account>(a as Account, dev));
    // 2) Frühere Import-Buchungen dieses Jahres, die es nicht mehr gibt, als gelöscht markieren
    const old = (await db.transactions.toArray()).filter((t) => t.source?.startsWith(source) && !newIds.has(t.id) && !t.deleted);
    await db.transactions.bulkPut(old.map((t) => stampSync<Transaction>({ ...t, deleted: 1 }, dev)));
    // 3) Neue/aktualisierte Buchungen (gleiche ID = überschreiben → keine Doppelten)
    await db.transactions.bulkPut(r.txs.map((t) => stampSync<Transaction>({ ...t, deleted: 0 } as Transaction, dev)));
  });
  const log = (await importLog()).filter((l) => l.year !== r.year);
  log.push({ year: r.year, mode: r.mode, at: new Date().toISOString(), count: r.txs.length, file: fileName });
  await setSetting('imports', log.sort((a, b) => a.year - b.year));
  return r.txs.length;
}

/** Nimmt alle Buchungen eines importierten Jahres wieder heraus (als gelöscht markiert, synchronisierbar) */
export async function removeImport(year: number): Promise<number> {
  const source = `excel:${year}:`;
  const rows = (await db.transactions.toArray()).filter((t) => t.source?.startsWith(source) && !t.deleted);
  for (const t of rows) await db.transactions.put(await stamp({ ...t, deleted: 1 }));
  await setSetting('imports', (await importLog()).filter((l) => l.year !== year));
  return rows.length;
}
