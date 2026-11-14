import { useMemo, useState } from 'react';
import type { Interval, Recurring, Transaction } from '../db/schema';
import * as A from '../db/actions';
import { currentMonth, dayLabel, monthLabel, type Month } from '../lib/dates';
import { isActive, priceFor } from '../lib/recurring';
import { centsToInput, euro, euroShort, parseEuro, sum } from '../lib/money';
import { catColor, catIcon, catTint, type AppData } from '../data';
import { MonthStrip } from '../components/Header';
import { CategoryPicker, ConfirmButton, Field, Money, pressable, Sheet } from '../components/ui';

const INTERVAL: Record<Interval, string> = { monthly: 'monatlich', quarterly: 'vierteljährlich', yearly: 'jährlich' };
const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function BillRow({ t, onEdit }: { t: Transaction; onEdit: (t: Transaction) => void }) {
  return (
    <div className="row">
      <button className={`check ${t.paid ? 'on' : ''}`} aria-label={t.paid ? 'Als offen markieren' : 'Als bezahlt abhaken'} onClick={() => A.togglePaid(t.id)}>{t.paid ? '✓' : ''}</button>
      <div className="grow click" {...pressable(() => onEdit(t))} style={{ cursor: 'pointer' }}>
        <div className="title" style={{ textDecoration: t.paid ? 'line-through' : undefined, opacity: t.paid ? 0.6 : 1 }}>{t.text}</div>
        <div className="sub">fällig {dayLabel(t.date)}</div>
      </div>
      <Money c={t.amount} className="amt" />
    </div>
  );
}

export function Bills({ d, month, setMonth, onEdit }: { d: AppData; month: Month; setMonth: (m: Month) => void; onEdit: (t: Transaction) => void }) {
  const [editRec, setEditRec] = useState<Recurring | 'new' | null>(null);
  const bills = useMemo(() => d.txs.filter((t) => t.kind === 'bill' && t.month === month).sort((a, b) => (a.date < b.date ? -1 : 1)), [d.txs, month]);
  const fixed = bills.filter((b) => !b.potId);
  const potRates = bills.filter((b) => b.potId);
  const total = sum(bills, (b) => b.amount);
  const paid = sum(bills.filter((b) => b.paid), (b) => b.amount);
  const startMonth = d.settings.startMonth as string | undefined;

  return (
    <>
      <div className="pagehead"><div><h1>Fixkosten</h1><div className="sub">Abhaken, sobald abgebucht</div></div></div>
      <MonthStrip month={month} onChange={setMonth} />
      <div className="cols c2">
        <div className="stack">
          <div className="card">
            <h2>{monthLabel(month)} <span className="muted">{euro(paid)} von {euro(total)} bezahlt</span></h2>
            <div className="track" style={{ marginBottom: 6 }}><i style={{ width: `${total ? (paid / total) * 100 : 0}%`, background: 'var(--pos)' }} /></div>
            {bills.length === 0 && (
              <div className="empty">
                {startMonth && month < startMonth ? `Fixkosten werden ab ${monthLabel(startMonth)} automatisch angelegt. Ältere Monate kommen mit dem Excel-Import.` : 'Keine Fixkosten fällig.'}
              </div>
            )}
            {fixed.map((t) => <BillRow key={t.id} t={t} onEdit={onEdit} />)}
          </div>
          {potRates.length > 0 && (
            <div className="card">
              <h2>Rücklagen aufs Tagesgeld <span className="muted">{euro(sum(potRates, (b) => b.amount))}</span></h2>
              {potRates.map((t) => <BillRow key={t.id} t={t} onEdit={onEdit} />)}
              <p className="small muted" style={{ margin: '8px 0 0' }}>Abhaken, sobald überwiesen. Erst dann zählt die Rate zum Topfstand.</p>
            </div>
          )}
        </div>
        <div className="card">
          <h2>Vorlagen <button className="btn sm primary" onClick={() => setEditRec('new')}>+ Neu</button></h2>
          {d.recurring.map((r) => {
            const active = isActive(r, currentMonth());
            return (
              <div className="row click" key={r.id} {...pressable(() => setEditRec(r))} style={{ opacity: active ? 1 : 0.5 }}>
                <span className="cico" style={{ background: catTint(catColor(d, r.categoryId)) }}>{catIcon(d, r.categoryId)}</span>
                <div className="grow">
                  <div className="title">{r.name}</div>
                  <div className="sub">
                    {INTERVAL[r.interval]}{r.interval !== 'monthly' && r.dueMonths ? ` (${r.dueMonths.map((m) => MONTH_SHORT[m - 1]).join(', ')})` : ''} · am {r.dueDay}.
                    {r.end ? ` · bis ${monthLabel(r.end)}` : ''}{!active && r.end ? ' (beendet)' : ''}
                  </div>
                </div>
                <Money c={priceFor(r, currentMonth())} />
              </div>
            );
          })}
        </div>
      </div>
      {editRec && <RecurringSheet d={d} rec={editRec === 'new' ? undefined : editRec} onClose={() => setEditRec(null)} />}
    </>
  );
}

function RecurringSheet({ d, rec, onClose }: { d: AppData; rec?: Recurring; onClose: () => void }) {
  const cm = currentMonth();
  const [name, setName] = useState(rec?.name ?? '');
  const [cat, setCat] = useState(rec?.categoryId ?? 'bill-abos');
  const [amount, setAmount] = useState(rec ? centsToInput(priceFor(rec, cm)) : '');
  const [priceFrom, setPriceFrom] = useState<Month>(cm);
  const [interval, setIv] = useState<Interval>(rec?.interval ?? 'monthly');
  const [dueMonths, setDueMonths] = useState<number[]>(rec?.dueMonths ?? [Number(cm.slice(5))]);
  const [dueDay, setDueDay] = useState(String(rec?.dueDay ?? 1));
  const [start, setStart] = useState<Month>(rec?.start ?? cm);
  const [end, setEnd] = useState<string>(rec?.end ?? '');
  const cents = parseEuro(amount);
  const priceChanged = rec && cents !== null && cents !== priceFor(rec, priceFrom);

  const toggleMonth = (m: number) => setDueMonths(dueMonths.includes(m) ? dueMonths.filter((x) => x !== m) : [...dueMonths, m].sort((a, b) => a - b));
  const save = async () => {
    if (!name.trim() || cents === null) return;
    const base = {
      id: rec?.id, name: name.trim(), categoryId: cat, interval, dueDay: Math.min(31, Math.max(1, Number(dueDay) || 1)),
      dueMonths: interval === 'monthly' ? undefined : dueMonths, start, end: end || undefined,
      prices: rec?.prices ?? [{ from: start, amount: cents }]
    };
    await A.saveRecurring(base);
    if (rec && priceChanged) await A.changePrice(rec.id, priceFrom, cents);
    await A.ensureMonth(cm);
    onClose();
  };
  return (
    <Sheet title={rec ? 'Fixkosten bearbeiten' : 'Neue Fixkosten'} onClose={onClose}>
      <Field label="Bezeichnung"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Netflix" /></Field>
      <div className="flex">
        <div className="grow"><Field label="Betrag"><input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
        {rec && (
          <div className="grow"><Field label="Betrag gilt ab"><input className="input" type="month" value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} /></Field></div>
        )}
      </div>
      {rec && rec.prices.length > 1 && (
        <p className="small muted" style={{ marginTop: -6 }}>Preis-Historie: {rec.prices.map((p) => `${euroShort(p.amount)} ab ${monthLabel(p.from)}`).join(' · ')}</p>
      )}
      <Field label="Bereich"><CategoryPicker d={d} group="bill" value={cat} onChange={setCat} /></Field>
      <Field label="Rhythmus">
        <div className="seg">
          {(Object.keys(INTERVAL) as Interval[]).map((i) => <button type="button" key={i} className={interval === i ? 'on' : ''} onClick={() => setIv(i)}>{INTERVAL[i]}</button>)}
        </div>
      </Field>
      {interval !== 'monthly' && (
        <Field label="Fällig in den Monaten">
          <div className="chips">{MONTH_SHORT.map((m, i) => <button type="button" key={m} className={`chip ${dueMonths.includes(i + 1) ? 'on' : ''}`} onClick={() => toggleMonth(i + 1)}>{m}</button>)}</div>
        </Field>
      )}
      <div className="flex">
        <div className="grow"><Field label="Abbuchung am (Tag)"><input className="input" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></Field></div>
        <div className="grow"><Field label="Ab Monat"><input className="input" type="month" value={start} onChange={(e) => setStart(e.target.value)} /></Field></div>
        <div className="grow"><Field label="Bis (Kündigung)"><input className="input" type="month" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
      </div>
      <p className="small muted">Bereits abgehakte Monate bleiben unverändert. Offene Monate werden angepasst.</p>
      <button className="btn primary block" onClick={save} disabled={!name.trim() || cents === null}>Speichern</button>
      {rec && (
        <ConfirmButton style={{ marginTop: 8 }} label="Vorlage löschen" confirmLabel={`Wirklich „${rec.name}“ löschen? Nochmal tippen`}
          onConfirm={async () => { await A.deleteRecurring(rec.id); onClose(); }} />
      )}
    </Sheet>
  );
}
