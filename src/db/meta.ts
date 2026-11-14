import { db, type SyncMeta } from './schema';

let cachedDeviceId: string | null = null;

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Eindeutige Geräte-ID (für die spätere Synchronisation) */
export async function deviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const s = await db.settings.get('deviceId');
  if (s) {
    cachedDeviceId = s.value as string;
  } else {
    cachedDeviceId = newId();
    await db.settings.put({ key: 'deviceId', value: cachedDeviceId });
  }
  return cachedDeviceId;
}

/** Setzt ID (falls neu), Zeitstempel und Geräte-ID – bei jeder Änderung aufrufen */
export async function stamp<T extends SyncMeta>(obj: Omit<T, 'id' | 'updatedAt' | 'deviceId'> & Partial<SyncMeta>): Promise<T> {
  return { deleted: 0, ...obj, id: obj.id ?? newId(), updatedAt: nowIso(), deviceId: await deviceId() } as T;
}

/**
 * Synchrone Variante für die Verwendung INNERHALB einer Datenbank-Transaktion
 * (dort darf nicht auf fremde Promises gewartet werden). Geräte-ID vorher mit deviceId() holen.
 */
export function stampSync<T extends SyncMeta>(obj: Omit<T, 'id' | 'updatedAt' | 'deviceId'> & Partial<SyncMeta>, dev: string): T {
  return { deleted: 0, ...obj, id: obj.id ?? newId(), updatedAt: nowIso(), deviceId: dev } as T;
}

export const alive = <T extends { deleted?: 0 | 1 }>(x: T) => !x.deleted;
