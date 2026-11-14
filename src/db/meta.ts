import { db, type SyncMeta } from './schema';

const cachedDeviceId = new Map<string, string>(); // je Datenbank (Tests simulieren mehrere Geräte)

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Zeitstempel für Änderungen – streng steigend („hybride logische Uhr“):
 * - zwei Änderungen bekommen nie denselben Zeitstempel (auch nicht in derselben Millisekunde),
 * - geht die Geräteuhr zurück, laufen die Zeitstempel trotzdem weiter vorwärts,
 * - nach dem Empfang fremder Änderungen liegt jede eigene neue Änderung zeitlich dahinter
 *   (eine vorgehende Uhr auf einem anderen Gerät kann spätere eigene Änderungen also nicht überstimmen).
 */
let clockFloor = 0;

/** Bekannten Zeitpunkt berücksichtigen (eigener letzter Upload, empfangene Änderungen) */
export function observeTime(iso: string | undefined | null) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(t) && t > clockFloor) clockFloor = t;
}

export function nowIso(): string {
  let t = Date.now();
  if (t <= clockFloor) t = clockFloor + 1;
  clockFloor = t;
  return new Date(t).toISOString();
}

/** Nur für Tests: simuliert ein anderes Gerät bzw. einen Neustart der App */
export function resetClock() {
  clockFloor = 0;
}

/** Beim App-Start (vor der ersten Änderung): gespeicherte Uhrzeit-Untergrenze laden */
export async function initClock() {
  for (const key of ['sync:clock', 'sync:lastPushAt']) observeTime((await db.settings.get(key))?.value as string | undefined);
}

/** Eindeutige Geräte-ID (für die spätere Synchronisation) */
export async function deviceId(): Promise<string> {
  const hit = cachedDeviceId.get(db.name);
  if (hit) return hit;
  const s = await db.settings.get('deviceId');
  let id = s?.value as string | undefined;
  if (!id) {
    id = newId();
    await db.settings.put({ key: 'deviceId', value: id });
  }
  cachedDeviceId.set(db.name, id);
  return id;
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
