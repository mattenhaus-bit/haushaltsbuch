import { useEffect, useState } from 'react';
import type { AppData } from '../data';
import { euro } from '../lib/money';
import { ConfirmButton, Field } from '../components/ui';
import { signIn, signOut, preloadGoogle } from '../sync/auth';
import { engine, syncNow, useSyncState } from '../sync/controller';
import type { Conflict } from '../sync/engine';
import { AuthError } from '../sync/drive';

type Step =
  | { kind: 'none' }
  | { kind: 'setup' }
  | { kind: 'showKey'; key: string }
  | { kind: 'unlock'; pending: number }
  | { kind: 'password' };

const TABLE_LABEL: Record<string, string> = {
  transactions: 'Buchung', recurring: 'Fixkosten', pots: 'Topf', categories: 'Kategorie', accounts: 'Konto', merchants: 'Laden', budgets: 'Plan'
};

function describe(r: Conflict['lost']) {
  const parts: string[] = [];
  if (r.deleted) parts.push('gelöscht');
  if (typeof r.text === 'string' && r.text) parts.push(r.text);
  else if (typeof r.name === 'string') parts.push(r.name);
  if (typeof r.amount === 'number') parts.push(euro(r.amount));
  if (typeof r.paid === 'number') parts.push(r.paid ? 'bezahlt' : 'offen');
  if (typeof r.date === 'string') parts.push(new Date(r.date).toLocaleDateString('de-DE'));
  return parts.join(' · ') || r.id;
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');

export function SyncCard({ d, toast }: { d: AppData; toast: (m: string) => void }) {
  const s = useSyncState();
  const connected = !!d.settings['sync:vault'];
  const last = d.settings['sync:last'] as { at: string; ok: boolean; error?: string } | undefined;
  const conflicts = (d.settings['sync:conflicts'] as Conflict[] | undefined) ?? [];
  const [step, setStep] = useState<Step>({ kind: 'none' });
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [discard, setDiscard] = useState(false);
  const [noted, setNoted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [snaps, setSnaps] = useState<{ id: string; at: string }[] | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => { preloadGoogle(); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const reset = () => { setStep({ kind: 'none' }); setPw(''); setPw2(''); setDiscard(false); setNoted(false); };

  // 1) Verbinden: anmelden, dann prüfen, ob es in Drive schon einen Tresor gibt
  const connect = () => run(async () => {
    await signIn();
    const vault = await engine.remoteVault();
    if (vault) setStep({ kind: 'unlock', pending: await engine.pendingCount() });
    else setStep({ kind: 'setup' });
  });

  const setup = () => run(async () => {
    if (pw.length < 10) throw new Error('Bitte mindestens 10 Zeichen verwenden.');
    if (pw !== pw2) throw new Error('Die beiden Passwörter stimmen nicht überein.');
    const key = await engine.setupVault(pw);
    setPw(''); setPw2('');
    setStep({ kind: 'showKey', key });
  });

  const [needLogin, setNeedLogin] = useState(false);
  const unlock = () => run(async () => {
    try {
      await engine.unlock(pw, { discardLocal: discard });
    } catch (e) {
      if (e instanceof AuthError) { setNeedLogin(true); throw new Error('Bitte zuerst bei Google anmelden.'); }
      throw e;
    }
    reset();
    await syncNow();
    toast('Verbunden – Daten werden synchronisiert');
  });

  const changePw = () => run(async () => {
    if (pw2.length < 10) throw new Error('Das neue Passwort braucht mindestens 10 Zeichen.');
    await engine.changePassword(pw, pw2);
    reset();
    toast('Tresor-Passwort geändert');
  });

  const login = () => run(async () => { await signIn(); await syncNow(); });

  const loadSnaps = () => run(async () => setSnaps(await engine.listSnapshots()));

  const statusLine = () => {
    switch (s.phase) {
      case 'syncing': return 'Synchronisiere …';
      case 'needs-login': return 'Google-Anmeldung abgelaufen – bitte kurz neu anmelden.';
      case 'locked': return 'Tresor gesperrt – bitte Passwort eingeben.';
      case 'offline': return 'Offline – Änderungen werden später übertragen.';
      case 'error': return `Fehler: ${s.message}`;
      default:
        return last ? (last.ok ? `Zuletzt synchronisiert: ${fmt(last.at)}` : `Letzter Versuch ${fmt(last.at)} fehlgeschlagen: ${last.error}`) : 'Noch nicht synchronisiert';
    }
  };

  // ---------- Ansichten ----------

  if (step.kind === 'showKey') {
    return (
      <div className="card">
        <h2>Wiederherstellungsschlüssel</h2>
        <p className="small" style={{ marginTop: 0 }}>
          Schreib diesen Schlüssel auf (Papier oder Passwort-Manager). Er ist der <strong>einzige Weg</strong> an deine Daten, falls du das Tresor-Passwort vergisst. Er wird nur dieses eine Mal angezeigt.
        </p>
        <div className="input num" style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1, textAlign: 'center', userSelect: 'all', wordBreak: 'break-all' }}>{step.key}</div>
        <label className="flex small" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={noted} onChange={(e) => setNoted(e.target.checked)} /> Ich habe den Schlüssel sicher notiert.
        </label>
        <button className="btn primary block" style={{ marginTop: 10 }} disabled={!noted} onClick={() => { reset(); syncNow(); }}>Fertig</button>
      </div>
    );
  }

  if (step.kind === 'setup') {
    return (
      <div className="card">
        <h2>Tresor einrichten</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Deine Daten werden auf diesem Gerät mit diesem Passwort verschlüsselt, bevor sie zu Google Drive gehen. Google sieht nur unlesbare Dateien. Das Passwort wird nirgends gespeichert – nimm ein eigenes, nicht dein Google-Passwort.
        </p>
        <Field label="Tresor-Passwort (mind. 10 Zeichen)"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Passwort wiederholen"><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <div className="flex" style={{ marginTop: 6 }}>
          <button className="btn primary grow" disabled={busy} onClick={setup}>{busy ? 'Richte ein …' : 'Tresor anlegen'}</button>
          <button className="btn" onClick={reset}>Abbrechen</button>
        </div>
      </div>
    );
  }

  if (step.kind === 'unlock' || (connected && s.phase === 'locked' && step.kind === 'none')) {
    const pending = step.kind === 'unlock' ? step.pending : 0;
    return (
      <div className="card">
        <h2>Mit deinem Tresor verbinden</h2>
        <p className="small muted" style={{ marginTop: 0 }}>In Google Drive gibt es schon einen Tresor. Gib dein Tresor-Passwort oder den Wiederherstellungsschlüssel ein.</p>
        <Field label="Tresor-Passwort oder Wiederherstellungsschlüssel"><input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {pending > 0 && (
          <div className="note" style={{ marginBottom: 10 }}>
            Auf diesem Gerät gibt es {pending} eigene Einträge, die noch nicht in Drive sind.
            <label className="flex" style={{ marginTop: 8 }}>
              <input type="radio" checked={!discard} onChange={() => setDiscard(false)} /> Behalten und mit Drive zusammenführen
            </label>
            <label className="flex" style={{ marginTop: 4 }}>
              <input type="radio" checked={discard} onChange={() => setDiscard(true)} /> Verwerfen – nur die Daten aus Drive verwenden (z. B. Testeinträge)
            </label>
          </div>
        )}
        {needLogin && <button className="btn block" style={{ marginBottom: 10 }} onClick={() => run(async () => { await signIn(); setNeedLogin(false); })}>Bei Google anmelden</button>}
        <div className="flex">
          <button className="btn primary grow" disabled={busy || !pw} onClick={unlock}>{busy ? 'Prüfe …' : 'Verbinden'}</button>
          <button className="btn" onClick={reset}>Abbrechen</button>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="card">
        <h2>Synchronisation</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Verbinde PC und iPhone über deinen Google-Drive-Speicher. Die App nutzt nur einen versteckten App-Ordner, sieht keine anderen Dateien und verschlüsselt alles vor dem Hochladen.
        </p>
        <button className="btn primary block" disabled={busy} onClick={connect}>{busy ? 'Verbinde …' : 'Mit Google Drive verbinden'}</button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Synchronisation</h2>
      <p className="small muted" style={{ marginTop: 0 }} role="status">
        {statusLine()}
        {s.lastReport && s.phase === 'idle' && (s.lastReport.pulled > 0 || s.lastReport.pushed > 0) && (
          <><br />Zuletzt: {s.lastReport.pushed} gesendet, {s.lastReport.pulled} empfangen</>
        )}
      </p>
      {s.phase === 'needs-login'
        ? <button className="btn primary block" disabled={busy} onClick={login}>Bei Google anmelden</button>
        : <button className="btn primary block" disabled={busy || s.phase === 'syncing'} onClick={() => syncNow()}>Jetzt synchronisieren</button>}

      {conflicts.length > 0 && (
        <div className="note" style={{ marginTop: 10 }}>
          {conflicts.length} gleichzeitige Änderung{conflicts.length > 1 ? 'en' : ''} zusammengeführt – die neuere Fassung wurde übernommen.{' '}
          <button className="btn sm" onClick={() => setShowConflicts(!showConflicts)}>{showConflicts ? 'Ausblenden' : 'Ansehen'}</button>
          {showConflicts && (
            <div style={{ marginTop: 8 }}>
              {conflicts.map((c, i) => (
                <div className="row" key={`${c.id}-${c.at}-${i}`}>
                  <div className="grow">
                    <div className="title">{TABLE_LABEL[c.table] ?? c.table}: {describe(c.kept)}</div>
                    <div className="sub">Verworfen: {describe(c.lost)} · {fmt(c.at)}</div>
                  </div>
                  <button className="btn sm" onClick={() => run(async () => { await engine.restoreConflict(i); toast('Verworfene Fassung wiederhergestellt'); syncNow(); })}>Zurückholen</button>
                </div>
              ))}
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => engine.dismissConflicts()}>Alles erledigt</button>
            </div>
          )}
        </div>
      )}

      <h3 style={{ margin: '16px 0 6px', fontSize: 15 }}>Sicherungen in Google Drive</h3>
      <p className="small muted" style={{ margin: '0 0 8px' }}>Die App legt automatisch wöchentlich einen verschlüsselten Gesamtstand an (die letzten 10 bleiben erhalten).</p>
      <div className="flex">
        <button className="btn grow" disabled={busy} onClick={() => run(async () => { await engine.createSnapshot(); toast('Sicherung in Drive angelegt'); setSnaps(await engine.listSnapshots()); })}>Jetzt sichern</button>
        <button className="btn grow" disabled={busy} onClick={loadSnaps}>Sicherungen anzeigen</button>
      </div>
      {snaps && (
        <div style={{ marginTop: 8 }}>
          {snaps.length === 0 && <div className="small muted">Noch keine Sicherung vorhanden.</div>}
          {snaps.map((x) => (
            <div className="row" key={x.id}>
              <div className="grow"><div className="title">{fmt(x.at)}</div></div>
              <ConfirmButton className="btn sm" label="Wiederherstellen" confirmLabel="Alle Geräte zurücksetzen?"
                onConfirm={() => run(async () => { await engine.restoreSnapshot(x.id); toast('Sicherung wiederhergestellt – auf allen Geräten'); setSnaps(null); })} />
            </div>
          ))}
        </div>
      )}

      {step.kind === 'password' ? (
        <div style={{ marginTop: 14 }}>
          <Field label="Altes Passwort oder Wiederherstellungsschlüssel"><input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Neues Tresor-Passwort (mind. 10 Zeichen)"><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <div className="flex">
            <button className="btn primary grow" disabled={busy} onClick={changePw}>Passwort ändern</button>
            <button className="btn" onClick={reset}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <div className="flex" style={{ marginTop: 14 }}>
          <button className="btn grow" onClick={() => setStep({ kind: 'password' })}>Tresor-Passwort ändern</button>
          <ConfirmButton className="btn grow" label="Gerät trennen" confirmLabel="Wirklich trennen?"
            onConfirm={() => run(async () => { await engine.disconnect(); await signOut(); await syncNow(); toast('Synchronisation auf diesem Gerät beendet – Daten bleiben erhalten'); })} />
        </div>
      )}
    </div>
  );
}
