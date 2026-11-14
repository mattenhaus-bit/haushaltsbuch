/**
 * Verschlüsselte Synchronisation über Google Drive (App-Ordner).
 *
 * Aufbau im Drive-App-Ordner (alle Dateien außer vault.json sind mit AES-256-GCM verschlüsselt):
 *   vault.json                 eingepackter Datenschlüssel (Passwort / Wiederherstellungsschlüssel) – keine Daten
 *   ops-<gerät>-<nr>-<zeit>.enc Änderungspaket eines Geräts (nur neue/geänderte Datensätze inkl. Löschmarken)
 *   snap-<zeit>-<gerät>.enc     vollständiger Stand (Sicherung + Startpunkt für neue Geräte)
 *
 * Jedes Gerät schreibt nur eigene Dateien – zwei Geräte überschreiben sich also nie gegenseitig eine Datei.
 * Zusammenführung je Datensatz: der neuere Stand gewinnt (updatedAt, bei Gleichstand Geräte-ID).
 * Wird dabei eine noch nicht hochgeladene eigene Änderung überstimmt (oder überstimmt sie eine fremde),
 * landet die unterlegene Fassung im Konfliktprotokoll und kann wiederhergestellt werden.
 */
import { db, GENESIS, SYNC_TABLES, type SyncTable } from '../db/schema';
import { deviceId, initClock, nowIso, observeTime } from '../db/meta';
import { ensureMonth, replaceAllData } from '../db/actions';
import { currentMonth } from '../lib/dates';
import { changeVaultPassword, createVault, decryptJson, encryptJson, openVault, type VaultFile } from './crypto';
import type { DriveLike, RemoteFile } from './drive';

const VAULT = 'vault.json';
const KEEP_SNAPSHOTS = 10;
const SNAPSHOT_AFTER_OPS = 40;
const SNAPSHOT_EVERY_MS = 7 * 86400_000;
const DELETE_OPS_AFTER_MS = 30 * 86400_000;
const MAX_CONFLICTS = 200;

type Row = { id: string; updatedAt: string; deviceId: string; deleted?: 0 | 1; [k: string]: unknown };
type Changes = Partial<Record<SyncTable, Row[]>>;

/** Welchen Stand je Gerät der Absender beim Erstellen der Datei kannte (höchster empfangener Zeitstempel) */
type Seen = Record<string, string>;
interface OpsFile { v: 1; device: string; createdAt: string; seen?: Seen; changes: Changes }
interface SnapshotFile { v: 1; device: string; createdAt: string; seen?: Seen; includes: string[]; data: Changes }

export interface Conflict {
  at: string;
  table: SyncTable;
  id: string;
  /** übernommene Fassung */
  kept: Row;
  /** unterlegene Fassung (kann wiederhergestellt werden) */
  lost: Row;
}

export interface SyncReport { pulled: number; pushed: number; conflicts: number; snapshot: boolean }
export type SyncStatus = 'no-vault' | 'locked' | 'ready';

// ---------- lokale Sync-Einstellungen (gerätebezogen, nie in Sicherungen) ----------
const K = {
  dek: 'sync:dek',
  vault: 'sync:vault',
  lastPushAt: 'sync:lastPushAt',
  seq: 'sync:seq',
  applied: 'sync:applied',
  conflicts: 'sync:conflicts',
  last: 'sync:last',
  /** zuletzt hochgeladene Fassungen kurz vor dem Cursor (Schutz vor spät gespeicherten Änderungen) */
  recent: 'sync:recent',
  /** je Gerät: höchster bereits empfangener Zeitstempel (wird in jede Datei geschrieben) */
  seen: 'sync:seen',
  /** höchster bekannter Zeitstempel (Untergrenze für die eigene Uhr) */
  clock: 'sync:clock'
} as const;

/** Sicherheitsfenster: Änderungen, deren Speicherung sich etwas verzögert hat, werden trotzdem erfasst */
const PUSH_WINDOW_MS = 10_000;

async function get<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return s === undefined ? fallback : (s.value as T);
}
const set = (key: string, value: unknown) => db.settings.put({ key, value });

/** Datenschlüssel im Speicher (zusätzlich lokal gespeichert, nicht exportierbar) – je Datenbank */
const dekCache = new Map<string, CryptoKey>();
async function loadDek(): Promise<CryptoKey | null> {
  const hit = dekCache.get(db.name);
  if (hit) return hit;
  const k = await get<CryptoKey | null>(K.dek, null);
  if (k) dekCache.set(db.name, k);
  return k;
}
async function storeDek(dek: CryptoKey) {
  dekCache.set(db.name, dek);
  try {
    await set(K.dek, dek);
  } catch {
    // Browser ohne CryptoKey-Speicherung: Schlüssel bleibt nur bis zum Neuladen im Speicher
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const stableKey = (r: Row) => {
  const { updatedAt: _u, deviceId: _d, ...rest } = r;
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
};
/** a ist neuer als b? */
const newer = (a: Row, b: Row) => a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.deviceId > b.deviceId);

const isOps = (f: RemoteFile) => f.name.startsWith('ops-') && f.name.endsWith('.enc');
const isSnap = (f: RemoteFile) => f.name.startsWith('snap-') && f.name.endsWith('.enc');
const snapTime = (f: RemoteFile) => Number(f.name.split('-')[1]) || 0;
const pad = (n: number) => String(n).padStart(8, '0');

export class SyncEngine {
  private running: Promise<unknown> = Promise.resolve();

  constructor(private drive: DriveLike) {}

  /** Alle Vorgänge nacheinander ausführen (nie zwei Synchronisationen gleichzeitig) */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.running.then(fn, fn);
    this.running = next.catch(() => undefined);
    return next;
  }

  // ---------- Tresor ----------

  async status(): Promise<SyncStatus> {
    if (!(await get<VaultFile | null>(K.vault, null))) return 'no-vault';
    return (await loadDek()) ? 'ready' : 'locked';
  }

  /** Liegt in Drive schon ein Tresor (dann „Entsperren“ statt „Einrichten“)? */
  async remoteVault(): Promise<VaultFile | null> {
    const f = (await this.drive.list()).find((x) => x.name === VAULT);
    if (!f) return null;
    return JSON.parse(dec.decode(await this.drive.download(f.id))) as VaultFile;
  }

  /** Ersteinrichtung auf dem ersten Gerät. Gibt den Wiederherstellungsschlüssel zurück (nur einmal anzeigen!). */
  setupVault(password: string): Promise<string> {
    return this.serial(async () => {
      if (password.length < 10) throw new Error('Das Passwort muss mindestens 10 Zeichen lang sein.');
      if (await this.remoteVault()) throw new Error('In Google Drive gibt es bereits einen Tresor. Bitte entsperren statt neu einrichten.');
      const { vault, dek, recoveryKey } = await createVault(password);
      await this.drive.upload(VAULT, enc.encode(JSON.stringify(vault)), 'application/json');
      await set(K.vault, vault);
      await storeDek(dek);
      await this.makeSnapshot([]); // vollständiger Startstand für weitere Geräte
      return recoveryKey;
    });
  }

  /** Anzahl eigener, noch nicht synchronisierter Datensätze (z. B. Testeinträge vor dem ersten Verbinden) */
  async pendingCount(): Promise<number> {
    return (await this.collectPending()).count;
  }

  /**
   * Gerät mit bestehendem Tresor verbinden (Passwort oder Wiederherstellungsschlüssel).
   * discardLocal: lokale Daten dieses Geräts verwerfen und nur den Stand aus Drive übernehmen.
   */
  unlock(secret: string, opts: { discardLocal?: boolean } = {}): Promise<void> {
    return this.serial(async () => {
      const vault = await this.remoteVault();
      if (!vault) throw new Error('In Google Drive wurde noch kein Tresor gefunden.');
      const dek = await openVault(vault, secret);
      if (opts.discardLocal) {
        await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
          for (const t of SYNC_TABLES) await db.table(t).clear();
        });
        await set(K.lastPushAt, GENESIS);
        await set(K.applied, []);
      }
      await set(K.vault, vault);
      await storeDek(dek);
    });
  }

  /** Passwort ändern (altes Passwort oder Wiederherstellungsschlüssel) */
  changePassword(oldSecret: string, newPassword: string): Promise<void> {
    return this.serial(async () => {
      if (newPassword.length < 10) throw new Error('Das Passwort muss mindestens 10 Zeichen lang sein.');
      const f = (await this.drive.list()).find((x) => x.name === VAULT);
      if (!f) throw new Error('Kein Tresor in Google Drive gefunden.');
      const vault = JSON.parse(dec.decode(await this.drive.download(f.id))) as VaultFile;
      const next = await changeVaultPassword(vault, oldSecret, newPassword);
      await this.drive.update(f.id, enc.encode(JSON.stringify(next)), 'application/json');
      await set(K.vault, next);
    });
  }

  /** Synchronisation auf diesem Gerät beenden (lokale Daten bleiben erhalten) */
  async disconnect() {
    dekCache.delete(db.name);
    const keys = (await db.settings.toArray()).map((s) => s.key).filter((k) => k.startsWith('sync:'));
    await db.settings.bulkDelete(keys);
  }

  // ---------- Synchronisieren ----------

  syncOnce(): Promise<SyncReport> {
    return this.serial(async () => {
      try {
        const report = await this.run();
        await set(K.last, { at: new Date().toISOString(), ok: true, report });
        return report;
      } catch (e) {
        await set(K.last, { at: new Date().toISOString(), ok: false, error: (e as Error).message });
        throw e;
      }
    });
  }

  private async requireDek() {
    const dek = await loadDek();
    if (!dek) throw new Error('Tresor ist gesperrt.');
    return dek;
  }

  private async run(): Promise<SyncReport> {
    const dek = await this.requireDek();
    await initClock();
    const report: SyncReport = { pulled: 0, pushed: 0, conflicts: 0, snapshot: false };
    let files = await this.drive.list();
    const applied = new Set(await get<string[]>(K.applied, []));

    // 1) Holen: neuester Gesamtstand (falls noch nicht übernommen), dann alle fremden Änderungspakete
    const snaps = files.filter(isSnap).sort((a, b) => snapTime(a) - snapTime(b));
    const latest = snaps[snaps.length - 1];
    if (latest && !applied.has(latest.name)) {
      const snap = await decryptJson<SnapshotFile>(dek, await this.drive.download(latest.id));
      const r = await this.merge(snap.data, snap.seen);
      report.pulled += r.changed;
      report.conflicts += r.conflicts;
      applied.add(latest.name);
      for (const n of snap.includes) applied.add(n);
    }
    const ops = files.filter(isOps).sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime) || a.name.localeCompare(b.name));
    for (const f of ops) {
      if (applied.has(f.name)) continue;
      const op = await decryptJson<OpsFile>(dek, await this.drive.download(f.id));
      const r = await this.merge(op.changes, op.seen);
      report.pulled += r.changed;
      report.conflicts += r.conflicts;
      applied.add(f.name);
      await set(K.applied, [...applied]); // Fortschritt sichern
    }
    if (report.pulled) await ensureMonth(currentMonth());

    // 2) Senden: eigene Änderungen seit dem letzten Hochladen
    const pending = await this.collectPending();
    if (pending.count) {
      const dev = await deviceId();
      const seq = (await get<number>(K.seq, 0)) + 1;
      const name = `ops-${dev.slice(0, 8)}-${pad(seq)}-${Date.now()}.enc`;
      const body: OpsFile = { v: 1, device: dev, createdAt: new Date().toISOString(), seen: await this.seenVector(pending.maxUpdatedAt), changes: pending.changes };
      const up = await this.drive.upload(name, await encryptJson(dek, body));
      files = [...files, up];
      applied.add(name);
      await set(K.seq, seq);
      await this.markPushed(pending.changes, pending.maxUpdatedAt);
      report.pushed = pending.count;
    }

    // Übernommene Dateien merken (nur solche, die es in Drive noch gibt)
    const names = new Set(files.map((f) => f.name));
    await set(K.applied, [...applied].filter((n) => names.has(n)));

    // 3) Aufräumen: regelmäßig einen Gesamtstand anlegen, alte Pakete/Stände entfernen
    const opsCount = files.filter(isOps).length;
    const lastSnap = latest ? snapTime(latest) : 0;
    if (opsCount > SNAPSHOT_AFTER_OPS || Date.now() - lastSnap > SNAPSHOT_EVERY_MS) {
      await this.makeSnapshot(files);
      report.snapshot = true;
    }
    return report;
  }

  /**
   * Prüffunktion „eigene Änderung, noch nicht hochgeladen“.
   * Cursor (letzter Upload) plus Sicherheitsfenster: Was kurz vor dem Cursor gestempelt, aber erst danach
   * gespeichert wurde, wird nicht übersehen; bereits hochgeladene Fassungen im Fenster werden übersprungen.
   */
  private async pendingFilter(): Promise<(t: SyncTable, r: Row) => boolean> {
    const dev = await deviceId();
    const since = await get<string>(K.lastPushAt, GENESIS);
    const recent = await get<Record<string, string>>(K.recent, {});
    const from = since === GENESIS ? GENESIS : new Date(Date.parse(since) - PUSH_WINDOW_MS).toISOString();
    return (t, r) => r.deviceId === dev && r.updatedAt > from && recent[`${t}/${r.id}`] !== r.updatedAt;
  }

  /** Nach erfolgreichem Hochladen: Cursor weiterschieben und Fassungen im Fenster merken */
  private async markPushed(changes: Changes, maxUpdatedAt: string) {
    const since = await get<string>(K.lastPushAt, GENESIS);
    const cursor = maxUpdatedAt > since ? maxUpdatedAt : since;
    const keepFrom = new Date(Date.parse(cursor) - PUSH_WINDOW_MS).toISOString();
    const recent = Object.fromEntries(Object.entries(await get<Record<string, string>>(K.recent, {})).filter(([, u]) => u > keepFrom));
    for (const t of SYNC_TABLES) for (const r of changes[t] ?? []) if (r.updatedAt > keepFrom) recent[`${t}/${r.id}`] = r.updatedAt;
    await set(K.recent, recent);
    await set(K.lastPushAt, cursor);
  }

  /** Eigene, noch nicht hochgeladene Datensätze */
  private async collectPending() {
    const isPending = await this.pendingFilter();
    const since = await get<string>(K.lastPushAt, GENESIS);
    const changes: Changes = {};
    let count = 0;
    let maxUpdatedAt = since;
    for (const t of SYNC_TABLES) {
      const rows = (await db.table(t).toArray() as Row[]).filter((r) => isPending(t, r));
      if (!rows.length) continue;
      changes[t] = rows;
      count += rows.length;
      for (const r of rows) if (r.updatedAt > maxUpdatedAt) maxUpdatedAt = r.updatedAt;
    }
    return { changes, count, maxUpdatedAt };
  }

  /** Kenntnisstand dieses Geräts (für die Konflikterkennung beim Empfänger) */
  private async seenVector(ownMax: string): Promise<Seen> {
    const dev = await deviceId();
    const seen = await get<Seen>(K.seen, {});
    const last = await get<string>(K.lastPushAt, GENESIS);
    const own = [ownMax, last, seen[dev] ?? GENESIS].sort().pop()!;
    return { ...seen, [dev]: own };
  }

  /**
   * Eingehende Datensätze zusammenführen (neuerer Stand gewinnt).
   * Konflikt = beide Seiten haben denselben Datensatz geändert, ohne die Änderung der anderen zu kennen.
   * Das erkennt der Kenntnisstand des Absenders (senderSeen): Kannte er unsere Fassung noch nicht,
   * war seine Änderung gleichzeitig – egal ob unsere schon hochgeladen war. Die unterlegene Fassung
   * landet dann im Konfliktprotokoll.
   */
  private async merge(changes: Changes, senderSeen?: Seen): Promise<{ changed: number; conflicts: number }> {
    const isPending = await this.pendingFilter();
    const dev = await deviceId();
    const knownByOther = senderSeen?.[dev] ?? '';
    const concurrent = (t: SyncTable, l: Row) =>
      l.deviceId === dev && l.updatedAt !== GENESIS && (isPending(t, l) || l.updatedAt > knownByOther);
    const seen = await get<Seen>(K.seen, {});
    const found: Conflict[] = [];
    let changed = 0;
    const now = new Date().toISOString();
    // Empfangene Zeitstempel merken: eigene spätere Änderungen liegen garantiert dahinter
    let maxSeen = await get<string>(K.clock, GENESIS);
    for (const t of SYNC_TABLES) for (const r of changes[t] ?? []) if (r?.updatedAt > maxSeen) maxSeen = r.updatedAt;
    observeTime(maxSeen);
    await set(K.clock, maxSeen);
    await db.transaction('rw', SYNC_TABLES.map((t) => db.table(t)), async () => {
      for (const t of SYNC_TABLES) {
        const incoming = (changes[t] ?? []).filter((r) => r && typeof r.id === 'string');
        if (!incoming.length) continue;
        const local = (await db.table(t).bulkGet(incoming.map((r) => r.id))) as (Row | undefined)[];
        const put: Row[] = [];
        incoming.forEach((r, i) => {
          const l = local[i];
          if (!l) { put.push(r); return; }
          if (stableKey(l) === stableKey(r)) {
            if (newer(r, l)) put.push(r); // gleicher Inhalt: nur Zeitstempel angleichen
            return;
          }
          // eine ältere eigene Fassung (z. B. in einem Gesamtstand eines anderen Geräts) ist kein Konflikt
          const unpushed = r.deviceId !== dev && concurrent(t, l);
          if (newer(r, l)) {
            put.push(r);
            if (unpushed) found.push({ at: now, table: t, id: r.id, kept: r, lost: l });
          } else if (unpushed) {
            found.push({ at: now, table: t, id: r.id, kept: l, lost: r });
          }
        });
        if (put.length) await db.table(t).bulkPut(put);
        changed += put.length;
        for (const r of incoming) if (!seen[r.deviceId] || r.updatedAt > seen[r.deviceId]) seen[r.deviceId] = r.updatedAt;
      }
    });
    await set(K.seen, seen);
    if (found.length) {
      const all = [...found, ...(await get<Conflict[]>(K.conflicts, []))].slice(0, MAX_CONFLICTS);
      await set(K.conflicts, all);
    }
    return { changed, conflicts: found.length };
  }

  /** Gesamtstand hochladen; alte Stände und bereits enthaltene alte Pakete löschen */
  private async makeSnapshot(files: RemoteFile[]) {
    const dek = await this.requireDek();
    const dev = await deviceId();
    const applied = await get<string[]>(K.applied, []);
    const data: Changes = {};
    const own: Changes = {};
    let maxUpdatedAt = await get<string>(K.lastPushAt, GENESIS);
    for (const t of SYNC_TABLES) {
      data[t] = (await db.table(t).toArray()) as Row[];
      own[t] = data[t]!.filter((r) => r.deviceId === dev);
      for (const r of own[t]!) if (r.updatedAt > maxUpdatedAt) maxUpdatedAt = r.updatedAt;
    }
    const includes = applied.filter((n) => n.startsWith('ops-'));
    const name = `snap-${Date.now()}-${dev.slice(0, 8)}.enc`;
    const body: SnapshotFile = { v: 1, device: dev, createdAt: new Date().toISOString(), seen: await this.seenVector(maxUpdatedAt), includes, data };
    await this.drive.upload(name, await encryptJson(dek, body));
    await set(K.applied, [...applied, name]);
    // Alles, was im Gesamtstand steckt, gilt als hochgeladen
    await this.markPushed(own, maxUpdatedAt);

    // Aufräumen
    const snaps = files.filter(isSnap).sort((a, b) => snapTime(b) - snapTime(a));
    for (const old of snaps.slice(KEEP_SNAPSHOTS - 1)) await this.drive.remove(old.id).catch(() => undefined);
    const inc = new Set(includes);
    const cutoff = Date.now() - DELETE_OPS_AFTER_MS;
    for (const f of files.filter(isOps)) {
      if (inc.has(f.name) && Date.parse(f.modifiedTime) < cutoff) await this.drive.remove(f.id).catch(() => undefined);
    }
  }

  // ---------- Sicherungen in Drive ----------

  async listSnapshots(): Promise<{ id: string; at: string; device: string }[]> {
    return (await this.drive.list())
      .filter(isSnap)
      .sort((a, b) => snapTime(b) - snapTime(a))
      .map((f) => ({ id: f.id, at: new Date(snapTime(f)).toISOString(), device: f.name.split('-')[2]?.replace('.enc', '') ?? '' }));
  }

  /** Jetzt einen Gesamtstand (Sicherung) in Drive anlegen */
  createSnapshot(): Promise<void> {
    return this.serial(async () => {
      await this.run();
      await this.makeSnapshot(await this.drive.list());
    });
  }

  /**
   * Einen früheren Gesamtstand wiederherstellen. Der Stand wird als neue Änderung dieses Geräts
   * übernommen und hochgeladen, damit auch alle anderen Geräte zurückgesetzt werden.
   */
  restoreSnapshot(id: string): Promise<void> {
    return this.serial(async () => {
      const dek = await this.requireDek();
      const snap = await decryptJson<SnapshotFile>(dek, await this.drive.download(id));
      await replaceAllData(snap.data as Record<string, unknown[]>);
      await ensureMonth(currentMonth());
      await this.run();
    });
  }

  // ---------- Konflikte ----------

  async conflicts(): Promise<Conflict[]> {
    return get<Conflict[]>(K.conflicts, []);
  }

  /** Unterlegene Fassung eines Konflikts wiederherstellen (als neue Änderung) */
  async restoreConflict(index: number) {
    const list = await this.conflicts();
    const c = list[index];
    if (!c) return;
    const dev = await deviceId();
    await db.table(c.table).put({ ...c.lost, updatedAt: nowIso(), deviceId: dev });
    await set(K.conflicts, list.filter((_, i) => i !== index));
  }

  async dismissConflicts() {
    await set(K.conflicts, []);
  }
}
