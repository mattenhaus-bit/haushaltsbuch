/**
 * Detailansicht hinter den Kacheln der Monatsübersicht (Einnahmen, Ausgaben, Fixkosten, Sparquote):
 * Vergleich zum Vormonat mit Erklärung, Stand seit Jahresbeginn, Vorjahresvergleich und Monatsverlauf.
 */
import { useMemo } from 'react';
import { rollupToMain, summarizeMonth, type MonthSummary } from '../lib/calc';
import { addMonths, monthShort, monthsOfYear, yearOf, type Month } from '../lib/dates';
import { euro, euroShort, type Cents } from '../lib/money';
import { catColor, type AppData } from '../data';
import { AreaLine, HBars, StackedBars } from '../components/Charts';
import { Sheet } from '../components/ui';

export type KpiKind = 'income' | 'expenses' | 'fix' | 'save';

const TITLE: Record<KpiKind, string> = { income: 'Einnahmen', expenses: 'Ausgaben', fix: 'Fixkosten', save: 'Sparen & Rücklagen' };
const COLOR: Record<KpiKind, string> = { income: 'var(--pos)', expenses: 'var(--s-exp)', fix: 'var(--s-fix)', save: 'var(--s-save)' };

/** Kennzahl je Monat – identisch zur Berechnung der Kacheln */
export const kpiValue = (k: KpiKind, s: MonthSummary): Cents =>
  k === 'income' ? s.income : k === 'expenses' ? s.expenses : k === 'fix' ? s.bills - s.potRates : s.savedOrInvested + s.potRates - s.withdrawals;

const sumv = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pctChange = (cur: number, prev: number) => (prev ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : null);
const signed = (c: Cents) => `${c > 0 ? '+' : c < 0 ? '−' : '±'}${euro(Math.abs(c))}`;

export function KpiSheet({ d, kind, month, onClose }: { d: AppData; kind: KpiKind; month: Month; onClose: () => void }) {
  const year = yearOf(month);
  const months = monthsOfYear(year);
  const idx = months.indexOf(month);
  const sums = useMemo(() => months.map((m) => summarizeMonth(m, d.txs, d.budgetAcc)), [d, year]);
  const prevYear = useMemo(() => monthsOfYear(year - 1).map((m) => summarizeMonth(m, d.txs, d.budgetAcc)), [d, year]);
  const prevMonth = addMonths(month, -1);
  const pm = useMemo(() => summarizeMonth(prevMonth, d.txs, d.budgetAcc), [d, prevMonth]);
  const cur = sums[idx];

  const v = (s: MonthSummary) => kpiValue(kind, s);
  const now = v(cur), before = v(pm);
  const ytd = sumv(sums.slice(0, idx + 1).map(v));
  const ytdPrev = sumv(prevYear.slice(0, idx + 1).map(v));
  const monthsWithData = sums.slice(0, idx + 1).filter((s) => s.income || s.expenses || s.bills).length || 1;
  const incomeYtd = sumv(sums.slice(0, idx + 1).map((s) => s.income));
  const rate = (val: Cents, inc: Cents) => (inc ? `${(Math.round((val / inc) * 1000) / 10).toLocaleString('de-DE')} %` : '–');
  const diff = now - before;
  const p = pctChange(now, before);
  const span = idx === 0 ? monthShort(month) : `Jan–${monthShort(month)}`;

  return (
    <Sheet title={`${TITLE[kind]} · ${monthShort(month)} ${year}`} onClose={onClose}>
      {/* Vergleich zum Vormonat */}
      <div className="kpihead">
        <div className="big num">{kind === 'save' ? euro(now) : euro(now)}</div>
        {kind === 'save' && <div className="small muted">Sparquote {rate(now, cur.income)} vom Einkommen</div>}
        <div className="kpicmp">
          <span>{monthShort(prevMonth)}: <b className="num">{euro(before)}</b></span>
          <span>Unterschied: <b className="num">{signed(diff)}</b>{p !== null && diff !== 0 ? ` (${p > 0 ? '+' : ''}${p} %)` : ''}</span>
        </div>
      </div>

      {kind === 'fix' && <FixChanges d={d} month={month} prevMonth={prevMonth} />}
      {kind === 'expenses' && <ExpenseChanges d={d} cur={cur} prev={pm} prevMonth={prevMonth} />}

      {/* Seit Jahresbeginn */}
      <div className="card flat">
        <h3>Seit Jahresbeginn <small>{span} {year}</small></h3>
        <div className="kpigrid">
          <div><span className="small muted">{kind === 'save' ? 'Zurückgelegt' : 'Summe'}</span><b className="num">{euro(ytd)}</b></div>
          <div><span className="small muted">Ø pro Monat</span><b className="num">{euro(Math.round(ytd / monthsWithData))}</b></div>
          {kind === 'save' && <div><span className="small muted">Sparquote</span><b className="num">{rate(ytd, incomeYtd)}</b></div>}
          {(kind === 'expenses' || kind === 'fix') && <div><span className="small muted">Anteil am Einkommen</span><b className="num">{rate(ytd, incomeYtd)}</b></div>}
          <div>
            <span className="small muted">Vorjahr {span}</span>
            <b className="num">{ytdPrev ? euro(ytdPrev) : '–'}</b>
            {ytdPrev !== 0 && <span className="small muted">{signed(ytd - ytdPrev)}</span>}
          </div>
        </div>
      </div>

      {kind === 'save' ? <SaveDetails d={d} sums={sums} idx={idx} /> : (
        <div className="card flat">
          <h3>Monatsverlauf {year}</h3>
          <StackedBars labels={months.map(monthShort)} stacks={[{ name: TITLE[kind], color: COLOR[kind], values: sums.map(v) }]}
            line={prevYear.some((s) => v(s)) ? { name: `Vorjahr ${year - 1}`, color: 'var(--muted)', values: prevYear.map(v) } : undefined} lineUntil={11} height={180} />
        </div>
      )}

      {kind === 'income' && <ByCategory d={d} title="Nach Einkommensart" sums={sums.slice(0, idx + 1)} pick={(_s, m) => incomeBy(d, m)} months={months.slice(0, idx + 1)} />}
      {kind === 'expenses' && <ByCategory d={d} title={`Nach Kategorie (${span})`} sums={sums.slice(0, idx + 1)} pick={(s) => rollupToMain(s.byCategory, d.categories)} months={months.slice(0, idx + 1)} />}
      {kind === 'fix' && <FixByPosition d={d} months={months.slice(0, idx + 1)} span={span} />}
    </Sheet>
  );
}

function incomeBy(d: AppData, m: Month): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const t of d.txs) if (!t.deleted && t.kind === 'income' && t.month === m && t.accountId === d.budgetAcc) out.set(t.categoryId ?? '?', (out.get(t.categoryId ?? '?') ?? 0) + t.amount);
  return out;
}

function ByCategory({ d, title, sums, months, pick }: { d: AppData; title: string; sums: MonthSummary[]; months: Month[]; pick: (s: MonthSummary, m: Month) => Map<string, Cents> }) {
  const total = new Map<string, Cents>();
  sums.forEach((s, i) => { for (const [k, v] of pick(s, months[i])) total.set(k, (total.get(k) ?? 0) + v); });
  const items = [...total.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!items.length) return null;
  return (
    <div className="card flat">
      <h3>{title}</h3>
      <HBars items={items.map(([id, value]) => ({ label: `${d.catById.get(id)?.icon ?? ''} ${d.catById.get(id)?.name ?? 'Ohne Kategorie'}`, value, color: catColor(d, id) }))} />
    </div>
  );
}

/** Fixkosten-Posten eines Monats (ohne Topf-Raten), nach Bezeichnung */
function billsOf(d: AppData, m: Month) {
  const out = new Map<string, { amount: Cents; open: Cents; cat?: string }>();
  for (const t of d.txs) {
    if (t.deleted || t.kind !== 'bill' || t.month !== m || t.potId) continue;
    const k = t.text ?? 'Ohne Bezeichnung';
    const e = out.get(k) ?? { amount: 0, open: 0, cat: t.categoryId };
    e.amount += t.amount;
    if (!t.paid) e.open += t.amount;
    out.set(k, e);
  }
  return out;
}

/** Erklärt, warum sich die Fixkosten zum Vormonat verändert haben */
function FixChanges({ d, month, prevMonth }: { d: AppData; month: Month; prevMonth: Month }) {
  const a = billsOf(d, prevMonth), b = billsOf(d, month);
  const names = new Set([...a.keys(), ...b.keys()]);
  const rows = [...names]
    .map((n) => ({ n, before: a.get(n)?.amount ?? 0, now: b.get(n)?.amount ?? 0, open: b.get(n)?.open ?? 0 }))
    .filter((r) => r.before !== r.now)
    .sort((x, y) => Math.abs(y.now - y.before) - Math.abs(x.now - x.before));
  const imported = d.txs.some((t) => t.kind === 'bill' && t.month === prevMonth && t.source?.startsWith('excel:'));
  const openNow = [...b.values()].reduce((s, x) => s + x.open, 0);
  return (
    <div className="card flat">
      <h3>Was sich zum {monthShort(prevMonth)} geändert hat</h3>
      {rows.length === 0 ? <div className="small muted">Gleiche Posten, gleiche Beträge.</div> : (
        <div>
          {rows.slice(0, 12).map((r) => (
            <div className="row" key={r.n}>
              <div className="grow">
                <div className="title">{r.n}</div>
                <div className="sub">
                  {r.before === 0 ? `nur im ${monthShort(month)}` : r.now === 0 ? `nur im ${monthShort(prevMonth)}` : `${euro(r.before)} → ${euro(r.now)}`}
                  {r.open > 0 ? ' · noch offen' : ''}
                </div>
              </div>
              <b className={`num ${r.now > r.before ? 'neg' : 'pos'}`}>{signed(r.now - r.before)}</b>
            </div>
          ))}
        </div>
      )}
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        Gezählt werden alle im Monat fälligen Fixkosten (auch noch offene{openNow ? `, aktuell ${euro(openNow)}` : ''}), ohne Topf-Raten.
        {imported ? ' Der Vormonat stammt aus der Excel-Datei – dort zählten wie gewohnt nur abgehakte Posten.' : ''}
        {' '}Jährliche oder halbjährliche Posten fallen nur in ihren Monaten an und lassen den Vergleich schwanken.
      </p>
    </div>
  );
}

function ExpenseChanges({ d, cur, prev, prevMonth }: { d: AppData; cur: MonthSummary; prev: MonthSummary; prevMonth: Month }) {
  const a = rollupToMain(prev.byCategory, d.categories), b = rollupToMain(cur.byCategory, d.categories);
  const rows = [...new Set([...a.keys(), ...b.keys()])]
    .map((id) => ({ id, diff: (b.get(id) ?? 0) - (a.get(id) ?? 0) }))
    .filter((r) => r.diff !== 0)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
    .slice(0, 5);
  if (!rows.length) return null;
  return (
    <div className="card flat">
      <h3>Größte Veränderungen zum {monthShort(prevMonth)}</h3>
      {rows.map((r) => (
        <div className="row" key={r.id}>
          <div className="grow title">{d.catById.get(r.id)?.icon} {d.catById.get(r.id)?.name ?? 'Ohne Kategorie'}</div>
          <b className={`num ${r.diff > 0 ? 'neg' : 'pos'}`}>{signed(r.diff)}</b>
        </div>
      ))}
      <p className="small muted" style={{ margin: '8px 0 0' }}>Ein laufender Monat ist noch nicht vollständig – der Vergleich ändert sich bis Monatsende.</p>
    </div>
  );
}

function FixByPosition({ d, months, span }: { d: AppData; months: Month[]; span: string }) {
  const total = new Map<string, { v: Cents; cat?: string }>();
  for (const m of months) for (const [k, e] of billsOf(d, m)) {
    const t = total.get(k) ?? { v: 0, cat: e.cat };
    t.v += e.amount;
    total.set(k, t);
  }
  const items = [...total.entries()].filter(([, e]) => e.v > 0).sort((a, b) => b[1].v - a[1].v).slice(0, 10);
  if (!items.length) return null;
  return (
    <div className="card flat">
      <h3>Größte Fixkosten ({span})</h3>
      <HBars items={items.map(([name, e]) => ({ label: name, value: e.v, color: catColor(d, e.cat ?? '') }))} />
    </div>
  );
}

function SaveDetails({ d, sums, idx }: { d: AppData; sums: MonthSummary[]; idx: number }) {
  const upTo = sums.slice(0, idx + 1);
  const saved = sumv(upTo.map((s) => s.savedOrInvested));
  const pots = sumv(upTo.map((s) => s.potRates));
  const out = sumv(upTo.map((s) => s.withdrawals));
  let run = 0;
  const cum = upTo.map((s) => (run += kpiValue('save', s)));
  // Insgesamt seit Beginn der Aufzeichnung
  const allMonths = [...new Set(d.txs.filter((t) => !t.deleted).map((t) => t.month))].sort().filter((m) => m <= sums[idx].month);
  const allTime = sumv(allMonths.map((m) => kpiValue('save', summarizeMonth(m, d.txs, d.budgetAcc))));
  const first = allMonths[0];
  return (
    <>
      <div className="card flat">
        <h3>Zusammensetzung</h3>
        <div className="row"><div className="grow">Gespart / investiert (Tagesgeld, Depot)</div><b className="num">{euro(saved)}</b></div>
        <div className="row"><div className="grow">Rücklagen in Töpfe</div><b className="num">{euro(pots)}</b></div>
        <div className="row"><div className="grow">Entnahmen (z. B. aus Tagesgeld ausgeglichen)</div><b className="num">−{euro(out)}</b></div>
        <div className="row"><div className="grow"><b>Zurückgelegt</b></div><b className="num">{euro(saved + pots - out)}</b></div>
        {first && <p className="small muted" style={{ margin: '8px 0 0' }}>Insgesamt seit {monthShort(first)} {yearOf(first)}: <b className="num">{euroShort(allTime)}</b></p>}
      </div>
      <div className="card flat">
        <h3>Angespart im Jahresverlauf</h3>
        <AreaLine labels={upTo.map((s) => monthShort(s.month))} values={cum} name="Zurückgelegt (kumuliert)" />
      </div>
    </>
  );
}
