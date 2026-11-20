import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Transaction } from '../db/schema';
import * as A from '../db/actions';
import { addMonths, budgetMonthForIncome, monthLabel, today } from '../lib/dates';
import { centsToInput, euro, parseEuro } from '../lib/money';
import { topCategories, type AppData } from '../data';
import { CategoryPicker, Field, Sheet } from './ui';
import { SuggestList } from './pickers';
import { buildHistory, catPath, categoryForText, suggestTexts, type HistoryItem } from '../lib/suggest';

export type EntryMode = 'expense' | 'trip' | 'income' | 'transfer';

interface Props {
  d: AppData;
  mode?: EntryMode;
  edit?: Transaction;
  preset?: Partial<{ from: string; to: string; amount: number; text: string }>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export function EntrySheet({ d, mode: initialMode = 'expense', edit, preset, onClose, onSaved }: Props) {
  const editMode: EntryMode | undefined = edit
    ? edit.kind === 'income' ? 'income' : edit.kind === 'transfer' ? 'transfer' : 'expense'
    : undefined;
  const [mode, setMode] = useState<EntryMode>(editMode ?? initialMode);
  const title = edit ? (edit.kind === 'bill' ? 'Fixkosten bearbeiten' : 'Buchung bearbeiten') : 'Neue Buchung';
  return (
    <Sheet title={title} onClose={onClose}>
      {!edit && (
        <div className="seg" style={{ marginBottom: 14 }}>
          {([['expense', 'Ausgabe'], ['trip', 'Einkauf'], ['income', 'Einnahme'], ['transfer', 'Umbuchung']] as const).map(([m, l]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
      )}
      {mode === 'expense' && <ExpenseForm d={d} edit={edit} onDone={onSaved} />}
      {mode === 'trip' && <TripForm d={d} onDone={onSaved} />}
      {mode === 'income' && <IncomeForm d={d} edit={edit} onDone={onSaved} />}
      {mode === 'transfer' && <TransferForm d={d} edit={edit} preset={preset} onDone={onSaved} />}
      {edit && (
        <button className="btn danger block" style={{ marginTop: 10 }} onClick={async () => { await A.deleteTx(edit.id); onSaved('Gelöscht'); }}>
          Löschen
        </button>
      )}
    </Sheet>
  );
}

function AmountField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 50); }, [autoFocus]);
  const parsed = parseEuro(value);
  return (
    <div className="amountbox">
      <input ref={ref} className="amount num" inputMode="decimal" placeholder="0,00 €" value={value}
        onChange={(e) => onChange(e.target.value)} aria-label="Betrag" />
      {value && parsed === null && <div className="small neg" style={{ textAlign: 'center' }}>Betrag nicht lesbar</div>}
    </div>
  );
}

function ExpenseForm({ d, edit, onDone }: { d: AppData; edit?: Transaction; onDone: (m: string) => void }) {
  const [amount, setAmount] = useState(edit ? centsToInput(edit.amount) : '');
  const [cat, setCat] = useState<string | undefined>(edit?.categoryId);
  const [text, setText] = useState(edit?.text ?? edit?.merchant ?? '');
  const [date, setDate] = useState(edit?.date ?? today());
  const [potId, setPotId] = useState(edit?.potId ?? '');
  const [catTouched, setCatTouched] = useState(!!edit);
  const top = useMemo(() => topCategories(d, 'expense', 8), [d]);
  const history = useMemo(() => buildHistory(d.txs, 'expense'), [d.txs]);
  const [textFocus, setTextFocus] = useState(false);
  const textHits = useMemo(() => (textFocus ? suggestTexts(text, history, d.merchants, 5) : []), [textFocus, text, history, d.merchants]);
  const isBill = edit?.kind === 'bill';
  const cents = parseEuro(amount);

  // Kategorie aus der Beschreibung ableiten (eigene frühere Buchungen, dann Läden-Regeln)
  useEffect(() => {
    if (catTouched || !text) return;
    const c = categoryForText(text, history, d.merchants);
    if (c) setCat(c);
  }, [text, catTouched, d.merchants, history]);

  const pickText = (h: HistoryItem) => {
    setText(h.text);
    if (!catTouched && h.categoryId) setCat(h.categoryId);
    if (!amount && h.amount) setAmount(centsToInput(h.amount));
  };

  const save = async () => {
    if (cents === null || cents === 0) return;
    if (edit) {
      await A.updateTx(edit.id, { amount: cents, categoryId: cat, text: text || undefined, date, ...(isBill ? {} : { potId: potId || undefined }) });
      onDone('Gespeichert');
    } else {
      await A.addExpense({ amount: cents, categoryId: cat ?? 'exp-sonstiges', text, date, potId: potId || undefined });
      onDone(`${euro(cents)} gespeichert`);
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <AmountField value={amount} onChange={setAmount} autoFocus={!edit} />
      {!isBill && (
        <Field label="Kategorie">
          <CategoryPicker d={d} group="expense" value={cat} top={top} history={history} onChange={(c) => { setCat(c); setCatTouched(true); }} />
        </Field>
      )}
      <div className="field">
        <label htmlFor="exp-text">{isBill ? 'Bezeichnung' : 'Beschreibung / Laden (optional)'}</label>
        <input id="exp-text" className="input" value={text} autoComplete="off" onChange={(e) => setText(e.target.value)}
          onFocus={() => setTextFocus(true)} onBlur={() => setTextFocus(false)} placeholder="z. B. Lidl, Geschenk …" />
        {!isBill && (
          <SuggestList label="Frühere Eingaben" items={textHits} onPick={pickText} render={(h) => (
            <>
              <span className="stack2">
                <span>{h.text}</span>
                <span className="small muted">{h.categoryId ? catPath(d.catById.get(h.categoryId), d.catById) : ''}{h.amount && h.count ? ` · zuletzt ${euro(h.amount)}` : ''}</span>
              </span>
            </>
          )} />
        )}
      </div>
      <div className="flex">
        <div className="grow"><Field label="Datum"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
        {!isBill && d.pots.length > 0 && (
          <div className="grow">
            <Field label="Bezahlt aus">
              <select className="input" value={potId} onChange={(e) => setPotId(e.target.value)}>
                <option value="">Haushaltskonto</option>
                {d.pots.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>Topf {p.name}</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>
      {potId && <div className="note">Wird aus dem Topf bezahlt und belastet den Monat nicht. Geld dafür vom Tagesgeld holen.</div>}
      <button className="btn primary block" disabled={cents === null || cents === 0}>Speichern</button>
    </form>
  );
}

interface TripRow { merchant: string; amount: string; categoryId?: string }

function TripForm({ d, onDone }: { d: AppData; onDone: (m: string) => void }) {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<TripRow[]>([{ merchant: '', amount: '' }]);
  const quick = d.merchants.filter((m) => m.quick);
  const history = useMemo(() => buildHistory(d.txs, 'expense'), [d.txs]);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [catRow, setCatRow] = useState<number | null>(null);
  const catOf = (r: TripRow) => r.categoryId ?? (r.merchant.trim() ? categoryForText(r.merchant, history, d.merchants) : undefined);
  const set = (i: number, patch: Partial<TripRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (parseEuro(r.amount) ?? 0), 0);
  const valid = rows.filter((r) => r.merchant.trim() && (parseEuro(r.amount) ?? 0) !== 0);
  const last = rows[rows.length - 1];
  const amountRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  // Fokus direkt nach dem Rendern setzen, damit sofortiges Tippen nicht verloren geht
  useLayoutEffect(() => {
    if (focusIdx !== null) { amountRefs.current[focusIdx]?.focus(); setFocusIdx(null); }
  }, [focusIdx, rows]);

  const pickMerchant = (label: string) => {
    const idx = last.merchant ? rows.length : rows.length - 1;
    const next = last.merchant ? [...rows, { merchant: label, amount: '' }] : rows.map((r, k) => (k === idx ? { ...r, merchant: label } : r));
    setRows(next);
    setFocusIdx(idx);
  };
  const save = async () => {
    if (!valid.length) return;
    await A.addTrip(date, valid.map((r) => ({ merchant: r.merchant.trim(), amount: parseEuro(r.amount)!, categoryId: catOf(r) })));
    onDone(`Einkauf ${euro(total)} gespeichert`);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field label="Laden antippen">
        <div className="chips">
          {quick.map((m) => <button type="button" key={m.id} className="chip" onClick={() => pickMerchant(m.label)}>{m.label}</button>)}
        </div>
      </Field>
      <div className="field">
        <label>Läden & Beträge</label>
        {rows.map((r, i) => {
          const c = catOf(r);
          const hits = focusRow === i ? suggestTexts(r.merchant, history, d.merchants, 5) : [];
          return (
            <div key={i}>
              <div className="tripRow">
                <input className="input" placeholder="Laden" aria-label={`Laden ${i + 1}`} autoComplete="off" value={r.merchant}
                  onFocus={() => setFocusRow(i)} onBlur={() => setFocusRow(null)}
                  onChange={(e) => set(i, { merchant: e.target.value, categoryId: undefined })} />
                <input ref={(el) => { amountRefs.current[i] = el; }} className="input num" inputMode="decimal" placeholder="0,00" aria-label={`Betrag ${i + 1}`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} />
                <button type="button" className="xbtn" aria-label="Zeile entfernen" onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [{ merchant: '', amount: '' }])}>✕</button>
              </div>
              <SuggestList label="Läden" items={hits} onPick={(h) => { set(i, { merchant: h.text, categoryId: undefined }); setFocusIdx(i); }} render={(h) => (
                <>
                  <span className="stack2">
                    <span>{h.text}</span>
                    <span className="small muted">{h.categoryId ? catPath(d.catById.get(h.categoryId), d.catById) : ''}</span>
                  </span>
                </>
              )} />
              {r.merchant.trim() && (
                <div className="tripCat">
                  → {c ? catPath(d.catById.get(c), d.catById) : 'Sonstiges'}
                  <button type="button" onClick={() => setCatRow(catRow === i ? null : i)}>{catRow === i ? 'fertig' : 'ändern'}</button>
                </div>
              )}
              {catRow === i && (
                <div style={{ marginBottom: 10 }}>
                  <CategoryPicker d={d} group="expense" value={c} history={history} onChange={(id) => { set(i, { categoryId: id }); setCatRow(null); }} />
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className="btn sm" onClick={() => setRows([...rows, { merchant: '', amount: '' }])}>+ weiterer Laden</button>
      </div>
      <Field label="Datum"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="flex" style={{ justifyContent: 'space-between', margin: '4px 2px 12px' }}>
        <span className="muted">Summe</span><strong className="num">{euro(total)}</strong>
      </div>
      <p className="small muted" style={{ marginTop: -6 }}>Die Kategorie wird am Laden erkannt – auch an deinen früheren Einkäufen. Mit „ändern“ lässt sie sich je Laden anpassen.</p>
      <button className="btn primary block" disabled={!valid.length}>Einkauf speichern</button>
    </form>
  );
}

function IncomeForm({ d, edit, onDone }: { d: AppData; edit?: Transaction; onDone: (m: string) => void }) {
  const shift = (d.settings.incomeShiftDay as number) ?? 25;
  const [amount, setAmount] = useState(edit ? centsToInput(edit.amount) : '');
  const [cat, setCat] = useState<string | undefined>(edit?.categoryId ?? 'inc-gehalt');
  const [text, setText] = useState(edit?.text ?? '');
  const [date, setDate] = useState(edit?.date ?? today());
  const auto = budgetMonthForIncome(date, shift);
  const [month, setMonth] = useState<string | null>(edit ? edit.month : null);
  const m = month ?? auto;
  const cents = parseEuro(amount);
  const last = useMemo(() => {
    const prev = d.txs.filter((t) => t.kind === 'income' && t.categoryId === cat).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return prev?.amount;
  }, [d.txs, cat]);
  const save = async () => {
    if (cents === null || cents === 0 || !cat) return;
    if (edit) await A.updateTx(edit.id, { amount: cents, categoryId: cat, text: text || undefined, date, month: m });
    else await A.addIncome({ amount: cents, categoryId: cat, date, text, month: m });
    onDone(edit ? 'Gespeichert' : `Einnahme ${euro(cents)} für ${monthLabel(m)}`);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <AmountField value={amount} onChange={setAmount} autoFocus={!edit} />
      {!edit && last !== undefined && !amount && (
        <button type="button" className="btn sm" style={{ marginBottom: 10 }} onClick={() => setAmount(centsToInput(last))}>Wie zuletzt: {euro(last)}</button>
      )}
      <Field label="Einkommensart"><CategoryPicker d={d} group="income" value={cat} onChange={setCat} /></Field>
      <Field label="Beschreibung (optional)"><input className="input" value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="flex">
        <div className="grow"><Field label="Eingang am"><input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setMonth(null); }} /></Field></div>
        <div className="grow">
          <Field label="Zählt für Monat">
            <select className="input" value={m} onChange={(e) => setMonth(e.target.value)}>
              {[-1, 0, 1].map((k) => addMonths(auto, k)).map((x) => <option key={x} value={x}>{monthLabel(x)}</option>)}
            </select>
          </Field>
        </div>
      </div>
      {auto !== date.slice(0, 7) && month === null && <p className="small muted" style={{ marginTop: -6 }}>Eingang ab dem {shift}. → zählt automatisch für den Folgemonat.</p>}
      <button className="btn primary block" disabled={cents === null || cents === 0}>Speichern</button>
    </form>
  );
}

function TransferForm({ d, edit, preset, onDone }: { d: AppData; edit?: Transaction; preset?: Props['preset']; onDone: (m: string) => void }) {
  const giro = d.budgetAcc ?? d.accounts[0]?.id;
  const [from, setFrom] = useState(edit?.accountId ?? preset?.from ?? giro);
  const [to, setTo] = useState(edit?.toAccountId ?? preset?.to ?? d.accounts.find((a) => a.kind === 'depot')?.id ?? '');
  const [amount, setAmount] = useState(edit ? centsToInput(edit.amount) : preset?.amount ? centsToInput(preset.amount) : '');
  const [text, setText] = useState(edit?.text ?? preset?.text ?? '');
  const [date, setDate] = useState(edit?.date ?? today());
  const [potId, setPotId] = useState(edit?.potId ?? '');
  const cents = parseEuro(amount);
  const toAcc = d.accounts.find((a) => a.id === to);
  const save = async () => {
    if (cents === null || cents <= 0 || from === to || !to) return;
    if (edit) await A.updateTx(edit.id, { accountId: from, toAccountId: to, amount: cents, text: text || undefined, date, potId: potId || undefined });
    else await A.addTransfer({ from, to, amount: cents, date, text, potId: potId || undefined });
    onDone('Umbuchung gespeichert');
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <AmountField value={amount} onChange={setAmount} autoFocus={!edit && !preset?.amount} />
      <div className="flex">
        <div className="grow"><Field label="Von"><select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{d.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field></div>
        <div className="grow"><Field label="Nach"><select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{d.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field></div>
      </div>
      {toAcc?.kind === 'tagesgeld' && from === giro && d.pots.length > 0 && (
        <Field label="Für Topf (optional)">
          <select className="input" value={potId} onChange={(e) => setPotId(e.target.value)}>
            <option value="">– Notgroschen / allgemein –</option>
            {d.pots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Notiz (optional)"><input className="input" value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <Field label="Datum"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <p className="small muted">Umbuchungen verschieben Geld zwischen deinen Konten. Sie sind weder Einnahme noch Ausgabe.</p>
      <button className="btn primary block" disabled={cents === null || cents <= 0 || from === to}>Speichern</button>
    </form>
  );
}
