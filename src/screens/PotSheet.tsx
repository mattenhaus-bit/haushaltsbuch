import { useState } from 'react';
import type { Pot } from '../db/schema';
import * as A from '../db/actions';
import { potStatus } from '../lib/calc';
import { currentMonth } from '../lib/dates';
import { centsToInput, euro, parseEuro } from '../lib/money';
import type { AppData } from '../data';
import { ConfirmButton, Field, Sheet } from '../components/ui';

const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Topf anlegen, bearbeiten, beenden (archivieren) oder löschen – erreichbar aus „Mehr“ und direkt aus der Monatsübersicht */
export function PotSheet({ d, pot, onClose, onDone }: { d: AppData; pot?: Pot; onClose: () => void; onDone?: (msg: string) => void }) {
  const [name, setName] = useState(pot?.name ?? '');
  const [yearly, setYearly] = useState(pot ? centsToInput(pot.yearlyAmount) : '');
  const [rate, setRate] = useState(pot?.monthlyRate !== undefined ? centsToInput(pot.monthlyRate) : '');
  const [opening, setOpening] = useState(pot ? centsToInput(pot.openingBalance) : '0');
  const [due, setDue] = useState<number[]>(pot?.dueMonths ?? []);
  const y = parseEuro(yearly), r = rate ? parseEuro(rate) : undefined, o = parseEuro(opening) ?? 0;
  const tg = d.accounts.find((a) => a.kind === 'tagesgeld') ?? d.accounts[0];
  const st = pot ? potStatus(pot, d.txs) : undefined;
  const finish = (msg: string) => { onDone?.(msg); onClose(); };

  const valid = !!name.trim() && y !== null;

  /** Formular speichern – nur bei gültigen Eingaben */
  const save = async () => {
    if (!valid) return;
    await A.savePot({ id: pot?.id, name: name.trim(), yearlyAmount: y!, monthlyRate: r ?? undefined, openingBalance: o, dueMonths: due, accountId: pot?.accountId ?? tg.id, start: pot?.start ?? currentMonth(), archived: pot?.archived });
    await A.ensureMonth(currentMonth());
    finish('Topf gespeichert');
  };

  /** Beenden / Reaktivieren / Löschen wirken auf den gespeicherten Topf – unabhängig von (evtl. ungültigen) Änderungen im Formular */
  const setState = async (patch: Pick<Pot, 'archived'> | Pick<Pot, 'deleted'>, msg: string) => {
    if (!pot) return;
    const stored = d.pots.find((p) => p.id === pot.id) ?? pot;
    await A.savePot({ ...stored, ...patch });
    await A.ensureMonth(currentMonth());
    finish(msg);
  };

  return (
    <Sheet title={pot ? `Topf ${pot.name}` : 'Neuer Topf'} onClose={onClose}>
      {st && (
        <div className="note" style={{ marginBottom: 12 }}>
          Aktueller Stand: <b className="num">{euro(st.balance)}</b> · eingezahlt {euro(st.paidIn)} · ausgegeben {euro(st.paidOut)}
        </div>
      )}
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Auto-Reparatur" /></Field>
      <div className="flex">
        <div className="grow"><Field label="Jahresbedarf"><input className="input num" inputMode="decimal" value={yearly} onChange={(e) => setYearly(e.target.value)} /></Field></div>
        <div className="grow"><Field label="Monatsrate (leer = ÷12)"><input className="input num" inputMode="decimal" value={rate} placeholder={y ? centsToInput(Math.round(y / 12)) : ''} onChange={(e) => setRate(e.target.value)} /></Field></div>
      </div>
      <Field label="Anfangsbestand im Topf"><input className="input num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
      <Field label="Typische Fälligkeit">
        <div className="chips">{MONTH_SHORT.map((m, i) => <button type="button" key={m} className={`chip ${due.includes(i + 1) ? 'on' : ''}`} onClick={() => setDue(due.includes(i + 1) ? due.filter((x) => x !== i + 1) : [...due, i + 1].sort((a, b) => a - b))}>{m}</button>)}</div>
      </Field>
      {!valid && <p className="small neg" style={{ margin: '0 2px 8px' }}>Bitte Name und Jahresbedarf angeben.</p>}
      <button className="btn primary block" onClick={save} disabled={!valid}>Speichern</button>

      {pot && (
        <div className="dangerzone">
          <h3>Topf nicht mehr nötig?</h3>
          <p className="small muted" style={{ marginTop: 0 }}>Gilt für den gespeicherten Topf; ungespeicherte Änderungen oben werden verworfen.</p>
          {pot.archived ? (
            <button className="btn block" onClick={() => setState({ archived: 0 }, `Topf ${pot.name} wieder aktiv`)}>Wieder aktivieren</button>
          ) : (
            <>
              <button className="btn block" onClick={() => setState({ archived: 1 }, `Topf ${pot.name} beendet`)}>Topf beenden</button>
              <p className="small muted">Keine neuen Monatsraten mehr. Bisherige Buchungen und der Verlauf bleiben erhalten; der Topf wird ausgeblendet und lässt sich jederzeit wieder aktivieren.</p>
            </>
          )}
          <ConfirmButton label="Topf löschen" confirmLabel="Wirklich löschen?" style={{ marginTop: 8 }}
            onConfirm={() => setState({ deleted: 1 }, `Topf ${pot.name} gelöscht`)} />
          <p className="small muted">Entfernt den Topf und seine offenen Raten. Bereits bezahlte Raten und Ausgaben bleiben als Buchungen erhalten.
            {st && st.balance > 0 ? ` Restbestand ${euro(st.balance)} liegt weiter auf dem Tagesgeld.` : ''}</p>
        </div>
      )}
    </Sheet>
  );
}
