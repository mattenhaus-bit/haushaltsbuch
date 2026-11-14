import { useMemo, useState, type ReactNode } from 'react';
import { rollupToMain, summarizeMonth, type MonthSummary } from '../lib/calc';
import { currentMonth, dayLabel, monthShort, monthsOfYear, yearOf } from '../lib/dates';
import { euro, euroShort, type Cents } from '../lib/money';
import { catColor, catTint, type AppData } from '../data';
import { AreaLine, DonutLegend, HBars, Heatmap, StackedBars } from '../components/Charts';

const sumv = (a: number[]) => a.reduce((x, y) => x + y, 0);

function Tile({ k, color, v, d }: { k: string; color: string; v: ReactNode; d?: ReactNode }) {
  return <div className="tile"><div className="k"><i style={{ background: color }} />{k}</div><div className="v num">{v}</div>{d && <div className="d">{d}</div>}</div>;
}

function vsPrev(cur: Cents, prev: Cents, goodWhenUp: boolean) {
  if (!prev) return <span>Vorjahr ohne Daten</span>;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const good = (cur > prev) === goodWhenUp;
  return <span style={{ color: cur === prev ? undefined : good ? 'var(--pos)' : 'var(--neg)' }}>{cur >= prev ? '▲' : '▼'} {Math.abs(p)} % zum Vorjahr</span>;
}

export function Year({ d }: { d: AppData }) {
  const [year, setYear] = useState(yearOf(currentMonth()));
  const months = monthsOfYear(year);
  const labels = months.map(monthShort);
  const sums = useMemo(() => months.map((m) => summarizeMonth(m, d.txs, d.budgetAcc)), [d, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevSums = useMemo(() => monthsOfYear(year - 1).map((m) => summarizeMonth(m, d.txs, d.budgetAcc)), [d, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const T = (arr: MonthSummary[], f: (s: MonthSummary) => number) => sumv(arr.map(f));
  const fixOf = (s: MonthSummary) => s.bills - s.potRates;
  const savedOf = (s: MonthSummary) => s.savedOrInvested + s.potRates - s.withdrawals;
  const activeMonths = sums.filter((s) => s.income || s.expenses || s.bills).length || 1;

  const yearTx = useMemo(() => d.txs.filter((t) => yearOf(t.month) === year), [d.txs, year]);

  // Einnahmen nach Art
  const incomeByCat = useMemo(() => {
    const m = new Map<string, Cents[]>();
    for (const t of yearTx) if (t.kind === 'income' && t.accountId === d.budgetAcc) {
      const k = t.categoryId ?? 'inc-sonstige';
      const arr = m.get(k) ?? new Array(12).fill(0);
      arr[Number(t.month.slice(5)) - 1] += t.amount;
      m.set(k, arr);
    }
    return [...m.entries()].map(([id, vals]) => ({ id, vals, total: sumv(vals) })).sort((a, b) => b.total - a.total);
  }, [yearTx, d.budgetAcc]);

  // Fixkosten je Posten (Name), inkl. Raten und Topf-Raten
  const billsByName = useMemo(() => {
    const m = new Map<string, { vals: Cents[]; cat?: string; pot: boolean }>();
    for (const t of yearTx) if (t.kind === 'bill') {
      const k = t.text ?? '?';
      const e = m.get(k) ?? { vals: new Array(12).fill(0), cat: t.categoryId, pot: !!t.potId };
      e.vals[Number(t.month.slice(5)) - 1] += t.amount;
      m.set(k, e);
    }
    return [...m.entries()].map(([name, e]) => ({ name, ...e, total: sumv(e.vals) })).sort((a, b) => b.total - a.total);
  }, [yearTx]);

  // Ausgaben je Hauptkategorie und Unterkategorie
  const perMonthMain = sums.map((s) => rollupToMain(s.byCategory, d.categories));
  const mainIds = [...new Set(perMonthMain.flatMap((m) => [...m.keys()]))];
  const byMain = mainIds.map((id) => ({ id, vals: perMonthMain.map((m) => m.get(id) ?? 0) })).map((r) => ({ ...r, total: sumv(r.vals) })).sort((a, b) => b.total - a.total);
  const bySub = useMemo(() => {
    const m = new Map<string, Cents[]>();
    sums.forEach((s, i) => { for (const [k, v] of s.byCategory) { const a = m.get(k) ?? new Array(12).fill(0); a[i] += v; m.set(k, a); } });
    return m;
  }, [sums]);

  const raten = billsByName.filter((b) => b.cat === 'bill-raten');
  const ratenTotal = sumv(raten.map((r) => r.total));

  const inc = T(sums, (s) => s.income), fixT = T(sums, fixOf), expT = T(sums, (s) => s.expenses), savT = T(sums, savedOf);
  const pInc = T(prevSums, (s) => s.income), pFix = T(prevSums, fixOf), pExp = T(prevSums, (s) => s.expenses), pSav = T(prevSums, savedOf);
  const hasData = inc || expT || fixT;

  const lastIdx = Math.max(0, ...sums.map((x, i) => (x.income || x.expenses || x.bills ? i : 0)));
  let run = 0;
  const cumSaved = sums.slice(0, lastIdx + 1).map((s) => (run += savedOf(s)));

  const top20 = [
    ...billsByName.filter((b) => !b.pot).map((b) => ({ label: b.name, value: b.total, color: 'var(--s-fix)', sub: 'Fixkosten' })),
    ...billsByName.filter((b) => b.pot).map((b) => ({ label: b.name, value: b.total, color: 'var(--s-pot)', sub: 'Rücklage' })),
    ...[...bySub.entries()].map(([id, vals]) => ({ label: d.catById.get(id)?.name ?? '?', value: sumv(vals), color: catColor(d, id), sub: 'Ausgabe' }))
  ].sort((a, b) => b.value - a.value).slice(0, 20);

  const bigOnes = yearTx.filter((t) => t.kind === 'expense' && t.text !== 'Abgleich mit Excel-Monatsblatt').sort((a, b) => b.amount - a.amount).slice(0, 10);

  const cell = (v: Cents) => (Math.abs(v) < 50 ? (v ? '0 €' : '–') : euroShort(v));
  const Row = ({ label, vals, cls, icon }: { label: string; vals: Cents[]; cls?: string; icon?: string }) => (
    <tr className={cls}>
      <td title={label}><span className="cl">{icon ? `${icon} ${label}` : label}</span></td>
      {vals.map((v, i) => <td key={i} className={v ? '' : 'zero'}>{cell(v)}</td>)}
      <td className="sum">{cell(sumv(vals))}</td>
      <td className="sum">{cell(Math.round(sumv(vals) / activeMonths))}</td>
    </tr>
  );

  return (
    <>
      <div className="pagehead">
        <div><h1>Jahr {year}</h1><div className="sub">Jahres-Dashboard und Jahresübersicht</div></div>
        <div className="yearsw"><button onClick={() => setYear(year - 1)} aria-label="Vorjahr">‹</button><span>{year}</span><button onClick={() => setYear(year + 1)} aria-label="Folgejahr">›</button></div>
      </div>

      {!hasData && <div className="card empty">Für {year} gibt es noch keine Buchungen. Ältere Jahre kommen mit dem Excel-Import.</div>}
      {hasData ? (
        <div className="stack">
          <div className="tiles t6">
            <Tile k="Einnahmen" color="var(--pos)" v={euroShort(inc)} d={vsPrev(inc, pInc, true)} />
            <Tile k="Fixkosten" color="var(--s-fix)" v={euroShort(fixT)} d={vsPrev(fixT, pFix, false)} />
            <Tile k="Ausgaben" color="var(--s-exp)" v={euroShort(expT)} d={vsPrev(expT, pExp, false)} />
            <Tile k="Zurückgelegt" color="var(--s-save)" v={euroShort(savT)} d={vsPrev(savT, pSav, true)} />
            <Tile k="Sparquote" color="var(--s-save)" v={`${inc ? ((savT / inc) * 100).toFixed(1).replace('.', ',') : '0'} %`} d="Anteil vom Einkommen" />
            <Tile k="Ø Ausgaben / Monat" color="var(--s-exp)" v={euroShort(Math.round(expT / activeMonths))} d={`über ${activeMonths} Monate`} />
          </div>

          <div className="card">
            <h2>Einnahmen und Gesamtausgaben <small>pro Monat</small></h2>
            <StackedBars labels={labels} lineUntil={lastIdx} line={{ name: 'Einnahmen', color: 'var(--text)', values: sums.map((s) => s.income + s.withdrawals) }} stacks={[
              { name: 'Fixkosten', color: 'var(--s-fix)', values: sums.map(fixOf) },
              { name: 'Ausgaben', color: 'var(--s-exp)', values: sums.map((s) => s.expenses) },
              { name: 'Gespart / investiert', color: 'var(--s-save)', values: sums.map((s) => s.savedOrInvested) },
              { name: 'Rücklagen', color: 'var(--s-pot)', values: sums.map((s) => s.potRates) }
            ]} />
          </div>

          <div className="cols c2">
            <div className="card">
              <h2>Einnahmenübersicht <small>{euro(inc)}</small></h2>
              <DonutLegend segs={incomeByCat.map((r) => ({ label: d.catById.get(r.id)?.name ?? '?', value: r.total, color: catColor(d, r.id) }))}
                center={<><b className="num" style={{ fontSize: 17 }}>{euroShort(inc)}</b><span className="small muted">Einnahmen</span></>} />
            </div>
            <div className="card">
              <h2>Wohin das Geld ging <small>{euro(inc)}</small></h2>
              <DonutLegend segs={[
                { label: 'Fixkosten (ohne Raten)', value: fixT - ratenTotal, color: 'var(--s-fix)' },
                { label: 'Ausgaben', value: expT, color: 'var(--s-exp)' },
                { label: 'Gespart / investiert', value: T(sums, (s) => s.savedOrInvested), color: 'var(--s-save)' },
                { label: 'Rücklagen (Töpfe)', value: T(sums, (s) => s.potRates), color: 'var(--s-pot)' },
                { label: 'Raten / Schulden', value: ratenTotal, color: '#e34948' }
              ]} center={<><b className="num" style={{ fontSize: 17 }}>{euroShort(fixT + expT + T(sums, (s) => s.savedOrInvested + s.potRates))}</b><span className="small muted">verteilt</span></>} />
            </div>
          </div>

          <div className="cols c2">
            <div className="card">
              <h2>Ausgaben nach Kategorie <small>{euro(expT)}</small></h2>
              <HBars items={byMain.map((r) => ({ label: `${d.catById.get(r.id)?.icon ?? ''} ${d.catById.get(r.id)?.name ?? '?'}`, value: r.total, color: catColor(d, r.id) }))} />
            </div>
            <div className="card">
              <h2>10 größte Fixkosten <small>{euro(fixT)}</small></h2>
              <HBars items={billsByName.filter((b) => !b.pot).slice(0, 10).map((b) => ({ label: b.name, value: b.total, color: catColor(d, b.cat) }))} />
            </div>
          </div>

          <div className="cols c2">
            <div className="card">
              <h2>Zurückgelegt im Verlauf <small>kumuliert</small></h2>
              <AreaLine labels={labels.slice(0, lastIdx + 1)} values={cumSaved} name="Zurückgelegt (kumuliert)" />
              <p className="small muted" style={{ margin: '6px 0 0' }}>Sparen + Topf-Raten − Entnahmen aus dem Tagesgeld.</p>
            </div>
            <div className="card">
              <h2>20 größte Kostenpositionen</h2>
              <HBars items={top20} />
              <div className="legend"><span><i style={{ background: 'var(--s-fix)' }} />Fixkosten</span><span><i style={{ background: 'var(--s-pot)' }} />Rücklage</span><span><i style={{ background: 'var(--muted)' }} />Ausgabe (Kategoriefarbe)</span></div>
            </div>
          </div>

          <div className="card">
            <h2>Ausgaben-Heatmap <small>Kategorie × Monat, in €</small></h2>
            <Heatmap cols={labels} rows={byMain.map((r) => ({ label: `${d.catById.get(r.id)?.icon ?? ''} ${d.catById.get(r.id)?.name ?? '?'}`, values: r.vals }))} />
          </div>

          <details className="card tablewrap" open={window.innerWidth >= 900}>
            <summary>Jahresübersicht (Tabelle wie „Annual Totals“)</summary>
            <p className="small muted" style={{ margin: '0 0 8px' }}>Alle Monate mit Summe (Σ) und Monatsdurchschnitt (Ø). Auf dem Handy seitlich wischen.</p>
            <div className="scroll-x">
              <table className="matrix num">
                <thead><tr><th></th>{labels.map((l) => <th key={l}>{l}</th>)}<th>Σ</th><th>Ø</th></tr></thead>
                <tbody>
                  <tr className="sect"><td colSpan={15}>Zusammenfassung</td></tr>
                  <Row label="Einnahmen" vals={sums.map((s) => s.income)} />
                  <Row label="Entnahmen (Tagesgeld)" vals={sums.map((s) => s.withdrawals)} />
                  <Row label="Fixkosten" vals={sums.map(fixOf)} />
                  <Row label="Rücklagen (Töpfe)" vals={sums.map((s) => s.potRates)} />
                  <Row label="Ausgaben" vals={sums.map((s) => s.expenses)} />
                  <Row label="Gespart / investiert" vals={sums.map((s) => s.savedOrInvested)} />
                  <Row label="Verfügbar" vals={sums.map((s) => s.available)} cls="total" />

                  <tr className="sect"><td colSpan={15}>Einkommen</td></tr>
                  {incomeByCat.map((r) => <Row key={r.id} label={d.catById.get(r.id)?.name ?? '?'} icon={d.catById.get(r.id)?.icon} vals={r.vals} />)}
                  <Row label="Gesamteinkommen" vals={sums.map((s) => s.income)} cls="total" />

                  <tr className="sect"><td colSpan={15}>Fixkosten & Rücklagen</td></tr>
                  {billsByName.map((b) => <Row key={b.name} label={b.name} vals={b.vals} />)}
                  <Row label="Fixkosten inkl. Rücklagen" vals={sums.map((s) => s.bills)} cls="total" />

                  <tr className="sect"><td colSpan={15}>Ausgaben</td></tr>
                  {byMain.map((r) => (
                    <FragmentRows key={r.id} main={r} d={d} bySub={bySub} Row={Row} />
                  ))}
                  <Row label="Gesamtausgaben" vals={sums.map((s) => s.expenses)} cls="total" />
                </tbody>
              </table>
            </div>
          </details>

          {bigOnes.length > 0 && (
            <div className="card flush">
              <div className="h2" style={{ padding: '12px 0 0' }}>10 größte Einzelausgaben</div>
              {bigOnes.map((t) => (
                <div className="row" key={t.id}>
                  <span className="cico sm" style={{ background: catTint(catColor(d, t.categoryId)) }}>{d.catById.get(t.categoryId ?? '')?.icon ?? d.catById.get(d.catById.get(t.categoryId ?? '')?.parentId ?? '')?.icon ?? '•'}</span>
                  <div className="grow"><div className="title">{t.merchant ?? t.text ?? d.catById.get(t.categoryId ?? '')?.name}</div><div className="sub">{dayLabel(t.date)}</div></div>
                  <span className="amt num">{euro(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

function FragmentRows({ main, d, bySub, Row }: {
  main: { id: string; vals: Cents[] }; d: AppData; bySub: Map<string, Cents[]>;
  Row: (p: { label: string; vals: Cents[]; cls?: string; icon?: string }) => ReactNode;
}) {
  const subs = [...bySub.entries()].filter(([id]) => d.catById.get(id)?.parentId === main.id);
  const direct = bySub.get(main.id);
  const c = d.catById.get(main.id);
  const showSubs = subs.length > 1 || (subs.length === 1 && direct?.some((v) => v !== 0));
  return (
    <>
      <Row label={c?.name ?? '?'} icon={c?.icon} vals={main.vals} />
      {showSubs && subs.map(([id, vals]) => <Row key={id} label={`    ${d.catById.get(id)?.name}`} vals={vals} />)}
      {showSubs && direct?.some((v) => v !== 0) && <Row label="    ohne Unterkategorie" vals={direct} />}
    </>
  );
}
