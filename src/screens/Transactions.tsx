import { useMemo, useState } from 'react';
import type { Transaction, TxKind } from '../db/schema';
import { dayLabel, type Month } from '../lib/dates';
import { sum } from '../lib/money';
import { catColor, catIcon, catLabel, catTint, type AppData } from '../data';
import { Money, pressable } from '../components/ui';
import { MonthStrip } from '../components/Header';

const FILTERS: [string, TxKind | 'all'][] = [['Alle', 'all'], ['Ausgaben', 'expense'], ['Einnahmen', 'income'], ['Fixkosten', 'bill'], ['Umbuchungen', 'transfer']];
const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function Transactions({ d, month, setMonth, onEdit }: { d: AppData; month: Month; setMonth: (m: Month) => void; onEdit: (t: Transaction) => void }) {
  const [filter, setFilter] = useState<TxKind | 'all'>('all');
  const [q, setQ] = useState('');
  const accName = (id?: string) => d.accounts.find((a) => a.id === id)?.name ?? '?';

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return d.txs
      .filter((t) => (ql ? true : t.month === month))
      .filter((t) => filter === 'all' || t.kind === filter)
      .filter((t) => !ql || `${t.text ?? ''} ${t.merchant ?? ''} ${catLabel(d, t.categoryId)}`.toLowerCase().includes(ql))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.updatedAt > a.updatedAt ? 1 : -1)));
  }, [d, month, filter, q]);

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of list) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return [...m.entries()];
  }, [list]);

  const sign = (t: Transaction) => (t.kind === 'income' ? 1 : t.kind === 'transfer' ? 0 : -1);
  const title = (t: Transaction) => {
    if (t.kind === 'transfer') return `${accName(t.accountId)} → ${accName(t.toAccountId)}`;
    return t.merchant ?? t.text ?? catLabel(d, t.categoryId);
  };
  const subtitle = (t: Transaction) => {
    const parts: string[] = [];
    if (t.kind === 'transfer') parts.push(t.text ?? 'Umbuchung');
    else parts.push(catLabel(d, t.categoryId));
    if (t.merchant && t.text) parts.push(t.text);
    if (t.kind === 'bill') parts.push(t.paid ? 'bezahlt ✓' : 'offen');
    if (t.kind === 'expense' && t.potId) parts.push(`aus Topf ${d.pots.find((p) => p.id === t.potId)?.name ?? ''}`);
    if (t.kind === 'income' && t.month !== t.date.slice(0, 7)) parts.push('für Folgemonat');
    if (q) parts.push(dayLabel(t.date));
    return parts.join(' · ');
  };

  return (
    <>
      <div className="pagehead"><div><h1>Buchungen</h1><div className="sub">{list.length} Einträge</div></div></div>
      <MonthStrip month={month} onChange={setMonth} />
      <input className="input" placeholder="Suchen (alle Monate) …" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div className="chips" style={{ marginBottom: 6 }}>
        {FILTERS.map(([l, f]) => <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{l}</button>)}
      </div>
      {groups.length === 0 && <div className="empty">Keine Buchungen gefunden.</div>}
      {groups.map(([day, txs]) => {
        const out = sum(txs.filter((t) => t.kind === 'expense'), (t) => t.amount);
        const dt = new Date(day + 'T12:00');
        return (
          <div key={day}>
            <div className="daygroup flex"><span className="grow">{WEEKDAY[dt.getDay()]}, {dayLabel(day)}</span>{out > 0 && <span className="num">−{(out / 100).toFixed(2).replace('.', ',')} €</span>}</div>
            <div className="card flush">
              {txs.map((t) => (
                <div className="row click" key={t.id} {...pressable(() => onEdit(t))}>
                  <span className="cico" style={{ background: catTint(t.kind === 'transfer' ? '#8a93a3' : catColor(d, t.categoryId)) }}>{t.kind === 'transfer' ? '⇄' : catIcon(d, t.categoryId)}</span>
                  <div className="grow">
                    <div className="title">{title(t)}{t.tripId && <span className="muted small"> · Einkaufstour</span>}</div>
                    <div className="sub">{subtitle(t)}</div>
                  </div>
                  <Money c={sign(t) === 0 ? t.amount : sign(t) * t.amount} sign={sign(t) !== 0} className="amt" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
