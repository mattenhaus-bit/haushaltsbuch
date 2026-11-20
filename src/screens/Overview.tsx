import { useMemo, useState } from 'react';
import type { Transaction } from '../db/schema';
import { planSuggestion, potStatus, rollupToMain, summarizeMonth, type MonthSummary } from '../lib/calc';
import { addMonths, currentMonth, daysInMonth, dayLabel, monthLabel, monthShort, today, type Month } from '../lib/dates';
import { euro, euroShort, type Cents } from '../lib/money';
import { catColor, catIcon, catLabel, catTint, type AppData } from '../data';
import { CumulativeArea, PlanActualBars, Ring, Spark } from '../components/Charts';
import { MonthStrip } from '../components/Header';
import { pressable } from '../components/ui';
import type { EntryPreset } from '../App';
import { KpiSheet, type KpiKind } from './KpiSheet';
import { PotSheet } from './PotSheet';
import type { Pot } from '../db/schema';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Veränderung zum Vormonat in Euro, z. B. „▼ 258 € zu Okt“ (Details beim Antippen der Kachel) */
function Delta({ cur, prev, goodWhenUp, prevLabel }: { cur: Cents; prev: Cents; goodWhenUp: boolean; prevLabel: string }) {
  if (!prev) return <div className="d">kein Wert im {prevLabel}</div>;
  const diff = cur - prev;
  const p = Math.round((diff / Math.abs(prev)) * 100);
  const up = diff > 0;
  const cls = diff === 0 ? '' : up === goodWhenUp ? (up ? 'up-good' : 'down-good') : up ? 'up-bad' : 'down-bad';
  if (diff === 0) return <div className="d">= wie im {prevLabel}</div>;
  return <div className={`d ${cls}`} title={`${up ? '+' : '−'}${Math.abs(p)} % zum ${prevLabel}`}>{up ? '▲' : '▼'} {euroShort(Math.abs(diff))} zu {prevLabel}</div>;
}

export function Overview({ d, month, setMonth, openEntry, go, onEdit }: {
  d: AppData; month: Month; setMonth: (m: Month) => void; openEntry: (p: EntryPreset) => void; go: (s: 'bills' | 'more' | 'tx') => void; onEdit: (t: Transaction) => void;
}) {
  const s = useMemo(() => summarizeMonth(month, d.txs, d.budgetAcc), [month, d]);
  const [kpi, setKpi] = useState<KpiKind | null>(null);
  const [potEdit, setPotEdit] = useState<Pot | null>(null);
  const pl = monthShort(addMonths(month, -1));
  const hist = useMemo(() => Array.from({ length: 6 }, (_, i) => summarizeMonth(addMonths(month, i - 5), d.txs, d.budgetAcc)), [month, d]);
  const prev = hist[4];
  const last3 = hist.slice(2, 5).filter((h) => h.income || h.expenses || h.bills);
  const avg = (f: (h: MonthSummary) => number) => (last3.length ? Math.round(last3.reduce((a, h) => a + f(h), 0) / last3.length) : 0);

  const mains = useMemo(() => rollupToMain(s.byCategory, d.categories), [s, d.categories]);
  const plan = useMemo(() => planSuggestion(month, d.txs, d.categories, d.budgetAcc), [month, d]);
  const planTotal = [...plan.values()].reduce((a, b) => a + b, 0);
  const catRows = useMemo(() => {
    const ids = new Set([...mains.keys(), ...plan.keys()]);
    return [...ids].map((id) => ({ id, actual: mains.get(id) ?? 0, plan: plan.get(id) ?? 0 })).sort((a, b) => b.actual - a.actual || b.plan - a.plan);
  }, [mains, plan]);

  const tagesgeld = d.accounts.find((a) => a.kind === 'tagesgeld');
  const depot = d.accounts.find((a) => a.kind === 'depot');
  const pots = d.pots.filter((p) => !p.archived).map((p) => potStatus(p, d.txs));
  const potsTotal = pots.reduce((a, p) => a + p.balance, 0);

  // Verlauf im Monat (kumulierte flexible Ausgaben je Tag)
  const cumul = (m: Month) => {
    const n = daysInMonth(m);
    const per = new Array(n).fill(0);
    for (const t of d.txs) if (t.kind === 'expense' && t.month === m && t.accountId === d.budgetAcc) per[Math.min(n, Number(t.date.slice(8, 10))) - 1] += t.amount;
    for (let i = 1; i < n; i++) per[i] += per[i - 1];
    return per;
  };
  const days = daysInMonth(month);
  const cm = currentMonth();
  const todayIdx = month === cm ? Number(today().slice(8, 10)) - 1 : month < cm ? days - 1 : -1;

  const bills = d.txs.filter((t) => t.kind === 'bill' && t.month === month).sort((a, b) => (a.paid === b.paid ? (a.date < b.date ? -1 : 1) : a.paid ? 1 : -1));
  const recent = d.txs.filter((t) => t.month === month && t.kind !== 'bill').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);

  const fix = s.bills - s.potRates;
  const base = s.income + s.withdrawals;
  const segs = [
    { label: 'Fixkosten', value: fix, color: 'var(--s-fix)' },
    { label: 'Ausgaben', value: s.expenses, color: 'var(--s-exp)' },
    { label: 'Gespart / investiert', value: s.savedOrInvested, color: 'var(--s-save)' },
    { label: 'Rücklagen (Töpfe)', value: s.potRates, color: 'var(--s-pot)' }
  ];
  const saveRate = s.income ? Math.round(((s.savedOrInvested + s.potRates - s.withdrawals) / s.income) * 1000) / 10 : 0;
  const isPastOrNow = month <= cm;

  return (
    <>
      <div className="pagehead">
        <div><h1>{monthLabel(month)}</h1><div className="sub">Dein Monat auf einen Blick</div></div>
      </div>
      <MonthStrip month={month} onChange={setMonth} />

      <div className="cols c32">
        <div className="stack">
          {/* Monatsring */}
          <section className="hero" aria-label="Monatsbudget">
            <div className="top"><span>Monatsbudget</span><span>{pct(base - Math.max(0, s.available), base)} % verplant</span></div>
            <div className="body">
              <div className="ringc">
                <Ring segs={segs} total={Math.max(base, segs.reduce((a, x) => a + x.value, 0))} size={170} stroke={18} />
                <div className="center">
                  <span className="lbl">{Math.abs(s.available) < 100 ? 'Ausgeglichen' : s.available > 0 ? 'Verfügbar' : 'Fehlbetrag'}</span>
                  <span className="val num" style={{ color: s.available <= -100 ? '#ff9c9c' : undefined }}>{Math.abs(s.available) < 10000 ? euro(s.available) : euroShort(s.available)}</span>
                  <span className="of num">von {euroShort(base)}</span>
                </div>
              </div>
              <div className="legend">
                <div className="li"><span /><span>Einnahmen{s.withdrawals > 0 ? ' + Entnahmen' : ''}</span><span className="v num">{euro(base)}</span></div>
                {segs.map((x) => (
                  <div className="li" key={x.label}><span className="dot" style={{ background: x.color }} /><span>{x.label}</span><span className="v num">−{euro(x.value)}</span></div>
                ))}
                <div className="li rest"><span /><span>{s.available >= 0 ? 'Bleibt übrig' : 'Fehlt noch'}</span><span className="v num">{euro(s.available)}</span></div>
              </div>
            </div>
            <div className="actions">
              {s.available <= -100 && tagesgeld && d.budgetAcc && (
                <button className="hbtn primary" onClick={() => openEntry({ mode: 'transfer', from: tagesgeld.id, to: d.budgetAcc, amount: -s.available, text: `Ausgleich ${monthLabel(month)}` })}>Aus Tagesgeld ausgleichen</button>
              )}
              {s.available >= 100 && depot && d.budgetAcc && isPastOrNow && s.income > 0 && (
                <button className="hbtn primary" onClick={() => openEntry({ mode: 'transfer', from: d.budgetAcc, to: depot.id, amount: s.available, text: `Investieren ${monthLabel(month)}` })}>{euroShort(s.available)} investieren</button>
              )}
              {s.billsOpen > 0 && <button className="hbtn" onClick={() => go('bills')}>{euroShort(s.billsOpen)} Fixkosten offen</button>}
              <button className="hbtn" onClick={() => openEntry({ mode: 'trip' })}>Einkauf erfassen</button>
            </div>
          </section>

          <div className="tiles t4">
            <div className="tile click" {...pressable(() => setKpi('income'))} aria-label="Einnahmen – Details"><div className="k"><i style={{ background: 'var(--pos)' }} />Einnahmen</div><div className="v num">{euroShort(s.income)}</div><Delta cur={s.income} prev={prev.income} goodWhenUp prevLabel={pl} /><Spark values={hist.map((h) => h.income)} color="var(--pos)" /></div>
            <div className="tile click" {...pressable(() => setKpi('expenses'))} aria-label="Ausgaben – Details"><div className="k"><i style={{ background: 'var(--s-exp)' }} />Ausgaben</div><div className="v num">{euroShort(s.expenses)}</div><Delta cur={s.expenses} prev={prev.expenses} goodWhenUp={false} prevLabel={pl} /><Spark values={hist.map((h) => h.expenses)} color="var(--s-exp)" /></div>
            <div className="tile click" {...pressable(() => setKpi('fix'))} aria-label="Fixkosten – Details"><div className="k"><i style={{ background: 'var(--s-fix)' }} />Fixkosten</div><div className="v num">{euroShort(fix)}</div><Delta cur={fix} prev={prev.bills - prev.potRates} goodWhenUp={false} prevLabel={pl} /><Spark values={hist.map((h) => h.bills - h.potRates)} color="var(--s-fix)" /></div>
            <div className="tile click" {...pressable(() => setKpi('save'))} aria-label="Sparquote – Details"><div className="k"><i style={{ background: 'var(--s-save)' }} />Sparquote</div><div className="v num">{saveRate.toLocaleString('de-DE')} %</div><div className="d">{euroShort(s.savedOrInvested + s.potRates - s.withdrawals)} zurückgelegt</div><Spark values={hist.map((h) => (h.income ? (h.savedOrInvested + h.potRates - h.withdrawals) / h.income : 0))} color="var(--s-save)" /></div>
          </div>

          <div className="card">
            <h2>Ausgabenverlauf <small>{planTotal > 0 ? `Plan ${euroShort(planTotal)}` : 'flexible Ausgaben'}</small></h2>
            {todayIdx >= 0 || s.expenses > 0 ? (
              <CumulativeArea days={days} current={cumul(month)} previous={cumul(addMonths(month, -1))} budget={planTotal || undefined} todayIdx={todayIdx >= 0 ? todayIdx : days - 1} />
            ) : <div className="empty">Dieser Monat liegt in der Zukunft.</div>}
          </div>

          <div className="card">
            <h2>Plan und Ist <small>Plan = Ø der letzten 3 Monate</small></h2>
            <PlanActualBars groups={[
              { label: 'Einnahmen', plan: avg((h) => h.income), actual: s.income, color: 'var(--pos)' },
              { label: 'Fixkosten', plan: avg((h) => h.bills - h.potRates), actual: fix, color: 'var(--s-fix)' },
              { label: 'Ausgaben', plan: avg((h) => h.expenses), actual: s.expenses, color: 'var(--s-exp)' },
              { label: 'Gespart', plan: avg((h) => h.savedOrInvested + h.potRates), actual: s.savedOrInvested + s.potRates, color: 'var(--s-save)' }
            ]} />
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>Kategorien <small>{euro(s.expenses)}</small></h2>
            {catRows.length === 0 && <div className="empty">Noch keine Ausgaben. Tippe auf <b>+</b>.</div>}
            {catRows.filter((r) => r.actual !== 0).map((r) => {
              const c = d.catById.get(r.id);
              const col = catColor(d, r.id);
              const scale = Math.max(r.actual, r.plan, 1);
              return (
                <div className="row" key={r.id}>
                  <span className="cico" style={{ background: catTint(col) }}>{c?.icon ?? '•'}</span>
                  <div className="grow">
                    <div className="flex"><span className="grow title">{c?.name ?? 'Unbekannt'}</span><span className="amt num">{euro(r.actual)}</span></div>
                    <div className="track"><i style={{ width: `${(r.actual / scale) * 100}%`, background: col }} />{r.plan > 0 && <span className="planmark" style={{ left: `calc(${(r.plan / scale) * 100}% - 1px)` }} />}</div>
                    <div className="sub">{r.plan > 0 ? (r.actual > r.plan ? `${euroShort(r.actual - r.plan)} über Plan (${euroShort(r.plan)})` : `${euroShort(r.plan - r.actual)} unter Plan (${euroShort(r.plan)})`) : `${pct(r.actual, s.expenses)} % der Ausgaben`}</div>
                  </div>
                </div>
              );
            })}
            {catRows.some((r) => r.actual === 0) && (
              <div className="small muted" style={{ paddingTop: 10 }}>Noch nichts ausgegeben für: {catRows.filter((r) => r.actual === 0).map((r) => d.catById.get(r.id)?.name).join(', ')}</div>
            )}
          </div>

          <div className="card">
            <h2>Fixkosten im {monthShort(month)} <small>{euroShort(s.billsPaid)} von {euroShort(s.bills)} bezahlt</small></h2>
            {bills.length === 0 ? <div className="empty">Keine Fixkosten für diesen Monat.</div> : (
              <div className="upcoming">
                {bills.map((b) => (
                  <button key={b.id} className={`upc ${b.paid ? 'paid' : ''}`} onClick={() => go('bills')} style={{ textAlign: 'left' }}>
                    <div className="day">{b.paid ? '✓ bezahlt' : `fällig ${dayLabel(b.date).slice(0, 6)}`}</div>
                    <div className="nm">{b.text}</div>
                    <div className="am num">{euro(b.amount)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2>Tagesgeld & Töpfe <button className="btn sm" onClick={() => go('more')}>Alle Töpfe</button></h2>
            {tagesgeld?.floor !== undefined && (
              <div className="pot"><div className="jar"><i style={{ height: '100%', background: 'linear-gradient(180deg,#9ec5f4,#2a78d6)' }} /></div><div><div className="title">Notgroschen</div><div className="small muted">fester Sockel</div></div><b className="num">{euro(tagesgeld.floor)}</b></div>
            )}
            {pots.map((p) => {
              const fill = p.pot.yearlyAmount ? Math.max(0, Math.min(1, p.balance / p.pot.yearlyAmount)) : 0;
              return (
                <div className="pot click" key={p.pot.id} {...pressable(() => setPotEdit(p.pot))} aria-label={`Topf ${p.pot.name} bearbeiten`}>
                  <div className="jar"><i style={{ height: `${fill * 100}%` }} /></div>
                  <div><div className="title">{p.pot.name}</div><div className="small muted">{Math.round(fill * 100)} % vom Jahresbedarf {euroShort(p.pot.yearlyAmount)}</div></div>
                  <b className={`num ${p.balance < 0 ? 'neg' : ''}`}>{euro(p.balance)}</b>
                </div>
              );
            })}
            <div className="pot" style={{ borderBottom: 0 }}><span /><b>Tagesgeld soll</b><b className="num">{euro((tagesgeld?.floor ?? 0) + potsTotal)}</b></div>
          </div>

          <div className="card flush">
            <div className="h2" style={{ padding: '10px 0 0' }}>Letzte Buchungen <button className="btn sm" onClick={() => go('tx')}>Alle</button></div>
            {recent.length === 0 && <div className="empty">Noch nichts gebucht.</div>}
            {recent.map((t) => (
              <div className="row click" key={t.id} {...pressable(() => onEdit(t))}>
                <span className="cico sm" style={{ background: catTint(catColor(d, t.categoryId)) }}>{t.kind === 'transfer' ? '⇄' : catIcon(d, t.categoryId)}</span>
                <div className="grow"><div className="title">{t.kind === 'transfer' ? (t.text ?? 'Umbuchung') : t.merchant ?? t.text ?? catLabel(d, t.categoryId)}</div><div className="sub">{dayLabel(t.date)} · {t.kind === 'transfer' ? 'Umbuchung' : catLabel(d, t.categoryId)}</div></div>
                <span className={`amt num ${t.kind === 'income' || (t.kind !== 'transfer' && t.amount < 0) ? 'pos' : ''}`}>{t.kind === 'transfer' ? '' : t.kind === 'income' || t.amount < 0 ? '+' : '−'}{euro(Math.abs(t.amount))}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {kpi && <KpiSheet d={d} kind={kpi} month={month} onClose={() => setKpi(null)} />}
      {potEdit && <PotSheet d={d} pot={potEdit} onClose={() => setPotEdit(null)} />}
    </>
  );
}
