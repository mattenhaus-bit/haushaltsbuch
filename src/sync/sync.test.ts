/**
 * Tests der Verschlüsselung und der Synchronisation – zwei simulierte Geräte, ein gemeinsames (Speicher-)Drive.
 * Ausschließlich erfundene Beispielwerte.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HaushaltDB, setDb } from '../db/schema';
import { seedIfEmpty } from '../db/seed';
import * as A from '../db/actions';
import { createVault, decryptJson, encryptJson, kdf, openVault, changeVaultPassword } from './crypto';
import { MemoryDrive, type DriveLike } from './drive';
import { SyncEngine } from './engine';
import { initClock, resetClock } from '../db/meta';

const tick = () => new Promise((r) => setTimeout(r, 5));
let n = 0;

beforeAll(() => {
  kdf.iterations = 1000; // nur in Tests: schnellere Schlüsselableitung
});

describe('Verschlüsselung', () => {
  it('ver- und entschlüsselt; falsches Passwort wird abgelehnt; Wiederherstellungsschlüssel funktioniert', async () => {
    const { vault, dek, recoveryKey } = await createVault('ein-langes-passwort');
    const bytes = await encryptJson(dek, { betrag: 1234, text: 'Bäcker' });
    expect(new TextDecoder().decode(bytes)).not.toContain('Bäcker');
    expect(await decryptJson(dek, bytes)).toEqual({ betrag: 1234, text: 'Bäcker' });

    await expect(openVault(vault, 'falsch-falsch-falsch')).rejects.toThrow();
    const k1 = await openVault(vault, 'ein-langes-passwort');
    expect(await decryptJson(k1, bytes)).toEqual({ betrag: 1234, text: 'Bäcker' });
    const k2 = await openVault(vault, recoveryKey.toLowerCase().replace(/-/g, ' '));
    expect(await decryptJson(k2, bytes)).toEqual({ betrag: 1234, text: 'Bäcker' });

    // Vault-Datei enthält weder Passwort noch Klartext-Schlüssel
    expect(JSON.stringify(vault)).not.toContain('ein-langes-passwort');
    expect(JSON.stringify(vault)).not.toContain(recoveryKey);
  });

  it('manipulierte Daten werden erkannt', async () => {
    const { dek } = await createVault('ein-langes-passwort');
    const bytes = await encryptJson(dek, { a: 1 });
    bytes[bytes.length - 1] ^= 1;
    await expect(decryptJson(dek, bytes)).rejects.toThrow();
  });

  it('Passwort ändern – auch mit Wiederherstellungsschlüssel', async () => {
    const { vault, recoveryKey } = await createVault('altes-passwort-123');
    const v2 = await changeVaultPassword(vault, recoveryKey, 'neues-passwort-456');
    await expect(openVault(v2, 'altes-passwort-123')).rejects.toThrow();
    await openVault(v2, 'neues-passwort-456');
    await openVault(v2, recoveryKey); // Wiederherstellungsschlüssel bleibt gültig
  });
});

describe('Synchronisation zwischen zwei Geräten', () => {
  let drive: MemoryDrive;
  let pc: HaushaltDB;
  let phone: HaushaltDB;
  const engine = () => new SyncEngine(drive);
  // Gerät wechseln = eigene Uhr-Untergrenze des Geräts (wie nach einem App-Start) laden
  const on = async <T,>(dev: HaushaltDB, fn: () => Promise<T>) => { setDb(dev); resetClock(); await initClock(); return fn(); };
  const expenses = async () => (await (await import('../db/schema')).db.transactions.toArray()).filter((t) => t.kind === 'expense' && !t.deleted);

  beforeEach(async () => {
    drive = new MemoryDrive();
    pc = new HaushaltDB(`sync-pc-${++n}`);
    phone = new HaushaltDB(`sync-phone-${n}`);
    await on(pc, seedIfEmpty);
    await on(phone, seedIfEmpty);
  });

  async function connectBoth() {
    const rk = await on(pc, () => engine().setupVault('mein-tresor-passwort'));
    await on(phone, () => engine().unlock('mein-tresor-passwort'));
    return rk;
  }

  it('Einträge beider Geräte landen auf beiden Geräten; Drive enthält nur Verschlüsseltes', async () => {
    await on(pc, () => A.addExpense({ amount: 1111, date: '2030-03-01', categoryId: 'exp-kleidung', text: 'Jacke' }));
    await connectBoth();
    await on(phone, () => A.addExpense({ amount: 2222, date: '2030-03-02', categoryId: 'exp-kleidung', text: 'Schuhe' }));

    await on(phone, () => engine().syncOnce());
    await on(pc, () => engine().syncOnce());

    const a = await on(pc, expenses);
    const b = await on(phone, expenses);
    expect(a.map((t) => t.amount).sort()).toEqual([1111, 2222]);
    expect(b.map((t) => t.amount).sort()).toEqual([1111, 2222]);

    for (const f of drive.files.values()) {
      const text = new TextDecoder().decode(f.data);
      expect(text).not.toContain('Jacke');
      expect(text).not.toContain('Schuhe');
    }
  });

  it('Bearbeiten und Löschen werden übertragen', async () => {
    await connectBoth();
    const id = await on(pc, () => A.addExpense({ amount: 500, date: '2030-03-01', categoryId: 'exp-kleidung' }));
    await on(pc, () => engine().syncOnce());
    await on(phone, () => engine().syncOnce());
    expect((await on(phone, expenses))[0].id).toBe(id);

    await tick();
    await on(phone, () => A.updateTx(id, { amount: 650 }));
    await on(phone, () => engine().syncOnce());
    await on(pc, () => engine().syncOnce());
    expect((await on(pc, expenses))[0].amount).toBe(650);

    await tick();
    await on(pc, () => A.deleteTx(id));
    await on(pc, () => engine().syncOnce());
    await on(phone, () => engine().syncOnce());
    expect(await on(phone, expenses)).toHaveLength(0);
  });

  it('gleichzeitige Änderung: neuere gewinnt, die andere landet im Konfliktprotokoll und ist wiederherstellbar', async () => {
    await connectBoth();
    await on(pc, () => A.addExpense({ amount: 1000, date: '2030-03-01', categoryId: 'exp-kleidung' }));
    await on(pc, () => engine().syncOnce());
    await on(phone, () => engine().syncOnce());
    const id = (await on(pc, expenses))[0].id;

    await on(pc, () => A.updateTx(id, { amount: 1100 }));   // älter
    await tick();
    await on(phone, () => A.updateTx(id, { amount: 1200 })); // neuer

    await on(pc, () => engine().syncOnce());
    await on(phone, () => engine().syncOnce());
    await on(pc, () => engine().syncOnce());

    expect((await on(pc, expenses))[0].amount).toBe(1200);
    expect((await on(phone, expenses))[0].amount).toBe(1200);
    const conflicts = await on(phone, () => engine().conflicts());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].lost.amount).toBe(1100);
    expect(conflicts[0].kept.amount).toBe(1200);

    // Unterlegene Fassung zurückholen
    await tick();
    await on(phone, () => engine().restoreConflict(0));
    await on(phone, () => engine().syncOnce());
    await on(pc, () => engine().syncOnce());
    expect((await on(pc, expenses))[0].amount).toBe(1100);
  });

  it('abgehakte Fixkosten werden nicht durch automatisch erzeugte Monatseinträge überschrieben', async () => {
    const rec = { name: 'Testabo', categoryId: 'bill-abos', interval: 'monthly' as const, dueDay: 5, start: '2030-01', prices: [{ from: '2030-01', amount: 999 }] };
    await on(pc, () => A.saveRecurring(rec as never));
    await connectBoth();
    await on(phone, () => engine().syncOnce());
    await on(phone, () => A.ensureMonth('2030-04'));

    const { db } = await import('../db/schema');
    const bill = await on(phone, async () => (await db.transactions.toArray()).find((t) => t.kind === 'bill' && t.month === '2030-04' && t.text === 'Testabo')!);
    expect(bill).toBeTruthy();
    await tick();
    await on(phone, () => A.togglePaid(bill.id));
    await on(phone, () => engine().syncOnce());
    await tick();
    await on(pc, () => A.ensureMonth('2030-04')); // PC erzeugt den Monat erst jetzt – später als das Abhaken
    await on(pc, () => engine().syncOnce());
    await on(phone, () => engine().syncOnce());

    expect((await on(pc, () => db.transactions.get(bill.id)))!.paid).toBe(1);
    expect((await on(phone, () => db.transactions.get(bill.id)))!.paid).toBe(1);
    expect(await on(phone, () => engine().conflicts())).toHaveLength(0);
  });

  it('neues Gerät kann lokale Testdaten verwerfen und übernimmt den Stand aus Drive', async () => {
    await on(pc, () => A.addExpense({ amount: 4000, date: '2030-03-01', categoryId: 'exp-kleidung' }));
    await on(pc, () => engine().setupVault('mein-tresor-passwort'));
    await on(phone, () => A.addExpense({ amount: 1, date: '2030-03-01', categoryId: 'exp-kleidung', text: 'Test' }));

    expect(await on(phone, () => engine().pendingCount())).toBeGreaterThan(0);
    await on(phone, () => engine().unlock('mein-tresor-passwort', { discardLocal: true }));
    await on(phone, () => engine().syncOnce());
    expect((await on(phone, expenses)).map((t) => t.amount)).toEqual([4000]);
    await on(pc, () => engine().syncOnce());
    expect((await on(pc, expenses)).map((t) => t.amount)).toEqual([4000]);
  });

  it('falsches Passwort verbindet nicht', async () => {
    await on(pc, () => engine().setupVault('mein-tresor-passwort'));
    await expect(on(phone, () => engine().unlock('falsches-passwort'))).rejects.toThrow();
    expect(await on(phone, () => engine().status())).toBe('no-vault');
  });

  it('Sicherung in Drive wiederherstellen setzt beide Geräte zurück', async () => {
    await connectBoth();
    await on(pc, () => A.addExpense({ amount: 300, date: '2030-03-01', categoryId: 'exp-kleidung' }));
    await on(pc, () => engine().createSnapshot());
    const snaps = await on(pc, () => engine().listSnapshots());
    const target = snaps[0];

    await tick();
    await on(pc, () => A.addExpense({ amount: 999, date: '2030-03-02', categoryId: 'exp-kleidung' }));
    await on(pc, () => engine().syncOnce());
    await on(phone, () => engine().syncOnce());
    expect((await on(phone, expenses)).length).toBe(2);

    await tick();
    await on(pc, () => engine().restoreSnapshot(target.id));
    await on(phone, () => engine().syncOnce());
    expect((await on(pc, expenses)).map((t) => t.amount)).toEqual([300]);
    expect((await on(phone, expenses)).map((t) => t.amount)).toEqual([300]);
  });

  it('nach vielen Änderungspaketen entsteht ein Gesamtstand; ein drittes Gerät startet daraus', async () => {
    await connectBoth();
    for (let i = 0; i < 45; i++) {
      await on(pc, () => A.addExpense({ amount: 100 + i, date: '2030-03-01', categoryId: 'exp-kleidung' }));
      await on(pc, () => engine().syncOnce());
    }
    const snapCount = [...drive.files.values()].filter((f) => f.meta.name.startsWith('snap-')).length;
    expect(snapCount).toBeGreaterThanOrEqual(2);

    const tablet = new HaushaltDB(`sync-tablet-${n}`);
    await on(tablet, seedIfEmpty);
    await on(tablet, () => engine().unlock('mein-tresor-passwort'));
    await on(tablet, () => engine().syncOnce());
    expect((await on(tablet, expenses)).length).toBe(45);
  });

  describe('Zeitstempel (Befunde aus dem Codex-Review)', () => {
    afterEach(() => vi.restoreAllMocks());
    const freeze = (iso: string) => vi.spyOn(Date, 'now').mockReturnValue(Date.parse(iso));

    it('zwei Änderungen in derselben Millisekunde mit Upload dazwischen gehen beide hoch', async () => {
      await connectBoth();
      freeze('2031-01-01T10:00:00.000Z');
      await on(pc, () => A.addExpense({ amount: 101, date: '2030-03-01', categoryId: 'exp-kleidung' }));
      await on(pc, () => engine().syncOnce());
      await on(pc, () => A.addExpense({ amount: 202, date: '2030-03-01', categoryId: 'exp-kleidung' }));
      await on(pc, () => engine().syncOnce());
      vi.restoreAllMocks();
      await on(phone, () => engine().syncOnce());
      expect((await on(phone, expenses)).map((t) => t.amount).sort()).toEqual([101, 202]);
    });

    it('verspätet gespeicherte Änderung mit älterem Zeitstempel wird trotzdem hochgeladen', async () => {
      await connectBoth();
      await on(pc, () => A.addExpense({ amount: 300, date: '2030-03-01', categoryId: 'exp-kleidung' }));
      await on(pc, () => engine().syncOnce());
      const { db } = await import('../db/schema');
      const cursor = await on(pc, async () => (await db.settings.get('sync:lastPushAt'))!.value as string);
      const dev = await on(pc, async () => (await db.settings.get('deviceId'))!.value as string);
      const late = (await on(pc, expenses))[0];
      // simuliert: vor dem Upload gestempelt, aber erst danach gespeichert
      await on(pc, () => db.transactions.put({ ...late, id: 'spaet', amount: 333, updatedAt: new Date(Date.parse(cursor) - 2000).toISOString(), deviceId: dev }));
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());
      expect((await on(phone, expenses)).map((t) => t.amount).sort()).toEqual([300, 333]);
      // bereits hochgeladene Fassungen werden nicht ständig erneut gesendet
      expect((await on(pc, () => engine().syncOnce())).pushed).toBe(0);
    });

    it('vorgehende Uhr auf einem Gerät überstimmt keine spätere Änderung des anderen Geräts', async () => {
      await connectBoth();
      const id = await on(pc, () => A.addExpense({ amount: 1000, date: '2030-03-01', categoryId: 'exp-kleidung' }));
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());

      freeze('2031-06-01T12:00:00.000Z'); // iPhone-Uhr geht eine Stunde vor
      await on(phone, () => A.updateTx(id, { amount: 2400 }));
      await on(phone, () => engine().syncOnce());

      freeze('2031-06-01T11:10:00.000Z'); // PC (richtige Uhr) – sieht die Änderung und ändert danach
      await on(pc, () => engine().syncOnce());
      await on(pc, () => A.updateTx(id, { amount: 3000 }));
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());

      expect((await on(pc, expenses))[0].amount).toBe(3000);
      expect((await on(phone, expenses))[0].amount).toBe(3000);
    });
  });

  describe('Gleichzeitige Uploads (Befund aus dem 2. Codex-Review)', () => {
    /** Sicht auf das Drive, die erst den Stand von „vorhin“ zeigt (beide Geräte lesen die Liste, bevor eines hochlädt) */
    function staleView(base: MemoryDrive, visible: Set<string>): DriveLike {
      const own = new Set<string>();
      return {
        list: async () => (await base.list()).filter((f) => visible.has(f.id) || own.has(f.id)),
        upload: async (name, data) => { const f = await base.upload(name, data); own.add(f.id); return f; },
        update: (id, data) => base.update(id, data),
        download: (id) => base.download(id),
        remove: (id) => base.remove(id)
      };
    }

    it('beide laden parallel hoch: die unterlegene Fassung landet im Konfliktprotokoll', async () => {
      await connectBoth();
      const id = await on(pc, () => A.addExpense({ amount: 1000, date: '2030-03-01', categoryId: 'exp-kleidung' }));
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());

      await on(pc, () => A.updateTx(id, { amount: 1100 }));    // älter
      await tick();
      await on(phone, () => A.updateTx(id, { amount: 1200 })); // neuer

      const before = new Set((await drive.list()).map((f) => f.id));
      await on(pc, () => engine().syncOnce());                               // PC lädt hoch
      await on(phone, () => new SyncEngine(staleView(drive, before)).syncOnce()); // iPhone sah die Liste vor dem PC-Upload
      // beide sind „hochgeladen“ – jetzt normal abgleichen
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());

      expect((await on(pc, expenses))[0].amount).toBe(1200);
      expect((await on(phone, expenses))[0].amount).toBe(1200);
      const c = await on(pc, () => engine().conflicts());
      expect(c).toHaveLength(1);
      expect(c[0].lost.amount).toBe(1100);
      expect(c[0].kept.amount).toBe(1200);

      await tick();
      await on(pc, () => engine().restoreConflict(0));
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());
      expect((await on(phone, expenses))[0].amount).toBe(1100);
    });

    it('nacheinander (mit Abgleich dazwischen) entsteht kein Konflikt', async () => {
      await connectBoth();
      const id = await on(pc, () => A.addExpense({ amount: 1000, date: '2030-03-01', categoryId: 'exp-kleidung' }));
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());
      await on(pc, () => A.updateTx(id, { amount: 1100 }));
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());
      await tick();
      await on(phone, () => A.updateTx(id, { amount: 1300 }));
      await on(phone, () => engine().syncOnce());
      await on(pc, () => engine().syncOnce());
      expect((await on(pc, expenses))[0].amount).toBe(1300);
      expect(await on(pc, () => engine().conflicts())).toHaveLength(0);
      expect(await on(phone, () => engine().conflicts())).toHaveLength(0);
    });

    it('veralteter Gesamtstand eines anderen Geräts mit meiner alten Fassung ist kein Konflikt', async () => {
      await connectBoth();
      const id = await on(pc, () => A.addExpense({ amount: 1000, date: '2030-03-01', categoryId: 'exp-kleidung' }));
      await on(pc, () => engine().syncOnce());
      await on(phone, () => engine().syncOnce());
      await tick();
      await on(pc, () => A.updateTx(id, { amount: 1500 }));
      await on(pc, () => engine().syncOnce());
      // iPhone legt einen Gesamtstand an, ohne die PC-Änderung schon zu kennen
      await on(phone, () => new SyncEngine(staleView(drive, new Set())).createSnapshot());
      await on(pc, () => engine().syncOnce());
      expect((await on(pc, expenses))[0].amount).toBe(1500);
      expect(await on(pc, () => engine().conflicts())).toHaveLength(0);
    });
  });
});
