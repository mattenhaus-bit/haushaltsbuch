/**
 * Diagramm-Bausteine (eigenes SVG, keine Bibliothek).
 * Regeln: feste Farbe je Kategorie, eine Achse, dünne Marken mit 2px-Abstand, Legende ab 2 Serien,
 * Tooltip beim Antippen/Überfahren, Werte zusätzlich als Text/Tabelle (Farbe nie allein).
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { euro, euroShort, type Cents } from '../lib/money';

// ---------- Tooltip ----------
interface TipState { x: number; y: number; content: ReactNode }
export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content }), []);
  const hide = useCallback(() => setTip(null), []);
  const el = tip ? createPortal(<div className="tip" style={{ left: Math.min(Math.max(tip.x, 130), window.innerWidth - 130), top: tip.y }}>{tip.content}</div>, document.body) : null;
  return { el, show, hide };
}

export function TipRows({ title, rows }: { title?: string; rows: { label: string; value: Cents; color?: string }[] }) {
  return (
    <div>
      {title && <b>{title}</b>}
      {rows.map((r) => (
        <div className="tr" key={r.label}><i style={{ background: r.color ?? 'transparent' }} /><span>{r.label}</span><b className="num">{euro(r.value)}</b></div>
      ))}
    </div>
  );
}

/** Echte Breite des Containers, damit Schrift im Diagramm in Originalgröße bleibt */
function useWidth(fallback = 640): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(260, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---------- Ring / Donut ----------
export interface Seg { label: string; value: Cents; color: string }

export function Ring({ segs, total, size = 170, stroke = 16, track = 'rgba(255,255,255,0.12)' }: { segs: Seg[]; total?: Cents; size?: number; stroke?: number; track?: string }) {
  const t = useTip();
  const sum = segs.reduce((a, s) => a + Math.max(0, s.value), 0);
  const tot = Math.max(total ?? sum, sum, 1);
  const r = 50 - stroke / 2 / (size / 100);
  const sw = (stroke / size) * 100;
  const c = 2 * Math.PI * r;
  const gap = segs.filter((s) => s.value > 0).length > 1 ? 1.2 : 0;
  let off = 0;
  return (
    <>
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={segs.map((s) => `${s.label} ${euroShort(s.value)}`).join(', ')}>
        <circle cx="50" cy="50" r={r} fill="none" stroke={track} strokeWidth={sw} />
        {segs.map((s, i) => {
          if (s.value <= 0) return null;
          const len = (s.value / tot) * c;
          const el = (
            <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeLinecap="butt"
              strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 50 50)"
              onPointerMove={(e) => t.show(e, <TipRows rows={[{ label: s.label, value: s.value, color: s.color }]} />)} onPointerLeave={t.hide} style={{ cursor: 'pointer' }} />
          );
          off += len;
          return el;
        })}
      </svg>
      {t.el}
    </>
  );
}

/** Donut mit Legende (Wert + Anteil), z. B. Einnahmen- und Ausgabenübersicht wie im Excel-Dashboard */
export function DonutLegend({ segs, center, size = 150 }: { segs: Seg[]; center?: ReactNode; size?: number }) {
  const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0);
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <Ring segs={segs} size={size} stroke={22} track="var(--surface-3)" />
        {center && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>{center}</div>}
      </div>
      <div style={{ flex: '1 1 180px', display: 'grid', gap: 7, minWidth: 0 }}>
        {segs.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto auto', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)', fontWeight: 600 }}>{s.label}</span>
            <span className="num muted" style={{ fontSize: 12.5 }}>{total ? Math.round((s.value / total) * 100) : 0} %</span>
            <b className="num">{euroShort(s.value)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Achsen-Helfer ----------
function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => n <= x) ?? 10;
  return m * p;
}

// ---------- Gestapelte Säulen mit optionaler Linie ----------
export interface Series { name: string; color: string; values: Cents[] }

export function StackedBars({ labels, stacks, line, lineUntil, height = 220 }: { labels: string[]; stacks: Series[]; line?: Series; lineUntil?: number; height?: number }) {
  const t = useTip();
  const totals = labels.map((_, i) => stacks.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(...totals, ...(line?.values ?? [0])) / 100) * 100;
  const [ref, W] = useWidth();
  const H = height, L = 40, B = 24, T = 10;
  const ih = H - B - T, gw = (W - L) / labels.length, bw = Math.min(30, gw * 0.62);
  const y = (v: number) => T + ih - (ih * v) / max;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const lineVals = line ? line.values.slice(0, (lineUntil ?? line.values.length - 1) + 1) : [];
  const linePts = lineVals.map((v, i) => `${L + i * gw + gw / 2},${y(v)}`).join(' ');
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Monatsvergleich">
        {ticks.map((v) => (
          <g key={v}>
            <line className="gridline" x1={L} x2={W} y1={y(v)} y2={y(v)} />
            <text className="axis" x={L - 6} y={y(v) + 4} textAnchor="end">{v >= 100000 ? `${Math.round(v / 100000)}k` : Math.round(v / 100)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          let acc = 0;
          const x = L + i * gw + (gw - bw) / 2;
          const segs = stacks.map((s, k) => {
            const v = Math.max(0, s.values[i] ?? 0);
            const y0 = y(acc), y1 = y(acc + v);
            acc += v;
            const h = Math.max(0, y0 - y1 - (v > 0 && k > 0 ? 2 : 0));
            const isTop = stacks.slice(k + 1).every((n) => !(n.values[i] > 0));
            return v > 0 ? <rect key={k} x={x} y={y1} width={bw} height={h} rx={isTop ? 4 : 0} fill={s.color} /> : null;
          });
          return (
            <g key={i}>
              {segs}
              <rect x={L + i * gw} y={T} width={gw} height={ih} fill="transparent"
                onPointerMove={(e) => t.show(e, <TipRows title={l} rows={[...(line ? [{ label: line.name, value: line.values[i] ?? 0, color: line.color }] : []), ...stacks.map((s) => ({ label: s.name, value: s.values[i] ?? 0, color: s.color }))]} />)}
                onPointerLeave={t.hide} />
              <text className="axis" x={L + i * gw + gw / 2} y={H - 6} textAnchor="middle">{gw < 34 ? l.slice(0, 1) : l}</text>
            </g>
          );
        })}
        {line && (
          <>
            <polyline points={linePts} fill="none" stroke={line.color} strokeWidth="2.5" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
            {lineVals.map((v, i) => <circle key={i} cx={L + i * gw + gw / 2} cy={y(v)} r="4" fill={line.color} stroke="var(--surface)" strokeWidth="2" style={{ pointerEvents: 'none' }} />)}
          </>
        )}
      </svg>
      <div className="legend">
        {line && <span><i className="line" style={{ background: line.color }} />{line.name}</span>}
        {stacks.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
      </div>
      {t.el}
    </div>
  );
}

// ---------- Gruppierte Säulen: Plan vs. Ist ----------
export function PlanActualBars({ groups, height = 170 }: { groups: { label: string; plan: Cents; actual: Cents; color: string }[]; height?: number }) {
  const t = useTip();
  const max = niceMax(Math.max(1, ...groups.flatMap((g) => [g.plan, g.actual])) / 100) * 100;
  const [ref, W] = useWidth();
  const H = height, B = 24, T = 20, L = 4;
  const ih = H - B - T, gw = (W - L) / groups.length, bw = Math.min(42, gw * 0.3);
  const y = (v: number) => T + ih - (ih * Math.max(0, v)) / max;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Plan und Ist">
        <line className="gridline" x1={0} x2={W} y1={y(0)} y2={y(0)} />
        {groups.map((g, i) => {
          const cx = L + i * gw + gw / 2;
          return (
            <g key={g.label} onPointerMove={(e) => t.show(e, <TipRows title={g.label} rows={[{ label: 'Plan', value: g.plan, color: 'var(--s-plan)' }, { label: 'Ist', value: g.actual, color: g.color }]} />)} onPointerLeave={t.hide}>
              <rect x={L + i * gw} y={T} width={gw} height={ih} fill="transparent" />
              <rect x={cx - bw - 1} y={y(g.plan)} width={bw} height={y(0) - y(g.plan)} rx="4" fill="var(--s-plan)" />
              <rect x={cx + 1} y={y(g.actual)} width={bw} height={y(0) - y(g.actual)} rx="4" fill={g.color} />
              <text className="axis" x={cx + 1 + bw / 2} y={y(g.actual) - 5} textAnchor="middle" style={{ fill: 'var(--text-2)', fontWeight: 700 }}>{euroShort(g.actual)}</text>
              <text className="axis" x={cx} y={H - 6} textAnchor="middle">{g.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend"><span><i style={{ background: 'var(--s-plan)' }} />Plan (Ø 3 Monate)</span><span><i style={{ background: 'var(--text-2)' }} />Ist (farbig je Bereich)</span></div>
      {t.el}
    </div>
  );
}

// ---------- Verlauf im Monat (kumuliert), mit Vormonat als Vergleich ----------
export function CumulativeArea({ days, current, previous, budget, color = 'var(--s-exp)', height = 170, todayIdx }: {
  days: number; current: Cents[]; previous?: Cents[]; budget?: Cents; color?: string; height?: number; todayIdx?: number;
}) {
  const t = useTip();
  const max = niceMax(Math.max(1, ...current, ...(previous ?? [0]), budget ?? 0) / 100) * 100;
  const [ref, W] = useWidth();
  const H = height, L = 40, B = 22, T = 12;
  const ih = H - B - T, iw = W - L - 8;
  const x = (i: number) => L + (iw * i) / Math.max(1, days - 1);
  const y = (v: number) => T + ih - (ih * v) / max;
  const upto = todayIdx ?? days - 1;
  const cur = current.slice(0, upto + 1);
  const path = cur.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const area = cur.length ? `${path} L${x(cur.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : '';
  const prev = previous ? previous.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ') : '';
  const gid = `g${Math.random().toString(36).slice(2, 7)}`;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Ausgabenverlauf im Monat"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width * W - L) / iw * (days - 1));
          if (i < 0 || i >= days) return;
          t.show(e, <TipRows title={`${i + 1}. Tag`} rows={[...(i <= upto ? [{ label: 'Dieser Monat', value: current[i], color }] : []), ...(previous ? [{ label: 'Vormonat', value: previous[i] ?? 0, color: 'var(--muted)' }] : [])]} />);
        }} onPointerLeave={t.hide}>
        <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.35" /><stop offset="1" stopColor={color} stopOpacity="0.02" /></linearGradient></defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}><line className="gridline" x1={L} x2={W} y1={y(f * max)} y2={y(f * max)} /><text className="axis" x={L - 6} y={y(f * max) + 4} textAnchor="end">{Math.round((f * max) / 100)}</text></g>
        ))}
        {budget !== undefined && budget > 0 && (
          <g><line x1={L} x2={W} y1={y(budget)} y2={y(budget)} stroke="var(--text-2)" strokeDasharray="5 5" strokeWidth="1.5" /><text className="axis" x={W - 4} y={y(budget) - 5} textAnchor="end">Plan {euroShort(budget)}</text></g>
        )}
        {prev && <path d={prev} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />}
        {area && <path d={area} fill={`url(#${gid})`} />}
        {path && <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />}
        {cur.length > 0 && <circle cx={x(cur.length - 1)} cy={y(cur[cur.length - 1])} r="5" fill={color} stroke="var(--surface)" strokeWidth="2" />}
        {[1, 8, 15, 22, days].map((d) => <text key={d} className="axis" x={x(d - 1)} y={H - 5} textAnchor="middle">{d}.</text>)}
      </svg>
      <div className="legend"><span><i className="line" style={{ background: color }} />Dieser Monat</span>{previous && <span><i className="line" style={{ background: 'var(--muted)' }} />Vormonat</span>}</div>
      {t.el}
    </div>
  );
}

// ---------- Linie mit Fläche (z. B. kumuliert gespart im Jahr) ----------
export function AreaLine({ labels, values, color = 'var(--s-save)', height = 160, name }: { labels: string[]; values: Cents[]; color?: string; height?: number; name: string }) {
  const t = useTip();
  const lo = Math.min(0, ...values), hi = Math.max(1, ...values);
  const max = niceMax(hi / 100) * 100, min = lo < 0 ? -niceMax(-lo / 100) * 100 : 0;
  const [ref, W] = useWidth();
  const H = height, L = 40, B = 22, T = 10, ih = H - B - T, gw = (W - L) / labels.length;
  const x = (i: number) => L + i * gw + gw / 2;
  const y = (v: number) => T + ih - (ih * (v - min)) / (max - min);
  const pts = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const gid = `a${Math.random().toString(36).slice(2, 7)}`;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={name}>
        <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.3" /><stop offset="1" stopColor={color} stopOpacity="0.02" /></linearGradient></defs>
        {[min, (min + max) / 2, max].map((v) => <g key={v}><line className="gridline" x1={L} x2={W} y1={y(v)} y2={y(v)} /><text className="axis" x={L - 6} y={y(v) + 4} textAnchor="end">{Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(0)}k` : Math.round(v / 100)}</text></g>)}
        <path d={`${pts} L${x(values.length - 1)},${y(Math.max(min, 0))} L${x(0)},${y(Math.max(min, 0))} Z`} fill={`url(#${gid})`} />
        <path d={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
        {values.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r="4" fill={color} stroke="var(--surface)" strokeWidth="2" />
            <rect x={L + i * gw} y={T} width={gw} height={ih} fill="transparent" onPointerMove={(e) => t.show(e, <TipRows title={labels[i]} rows={[{ label: name, value: v, color }]} />)} onPointerLeave={t.hide} />
            <text className="axis" x={x(i)} y={H - 5} textAnchor="middle">{gw < 34 ? labels[i].slice(0, 1) : labels[i]}</text>
          </g>
        ))}
      </svg>
      {t.el}
    </div>
  );
}

// ---------- Horizontale Balkenliste (Top-Listen) ----------
export function HBars({ items, max }: { items: { label: string; value: Cents; color: string; sub?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div>
      {items.map((i, k) => (
        <div className="hbar" key={i.label + k} title={i.sub}>
          <span className="lbl">{i.label}</span>
          <span><span className="bar" style={{ display: 'block', width: `${Math.max(1, (i.value / m) * 100)}%`, background: i.color }} /></span>
          <span className="val num">{euroShort(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Heatmap Kategorie × Monat (sequenziell, eine Farbe) ----------
const SEQ = ['#eaf2fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
const SEQ_DARK = ['#16233a', '#18325a', '#184f95', '#1c5cab', '#256abf', '#3987e5', '#6da7ec'];
export function Heatmap({ rows, cols }: { rows: { label: string; values: Cents[] }[]; cols: string[] }) {
  const t = useTip();
  const dark = document.documentElement.dataset.theme === 'dark';
  const ramp = dark ? SEQ_DARK : SEQ;
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const step = (v: number) => (v <= 0 ? -1 : Math.min(ramp.length - 1, Math.floor((v / max) * (ramp.length - 1) + 0.5)));
  return (
    <div className="scroll-x">
      <div className="heat" style={{ gridTemplateColumns: `minmax(110px, 1.4fr) repeat(${cols.length}, minmax(34px, 1fr))`, minWidth: 560 }}>
        <span />
        {cols.map((c) => <span key={c} className="axis muted" style={{ textAlign: 'center', fontSize: 12, fontWeight: 700 }}>{c}</span>)}
        {rows.map((r) => (
          <HeatRow key={r.label} r={r} cols={cols} ramp={ramp} step={step} onTip={t} dark={dark} />
        ))}
      </div>
      <div className="legend" style={{ alignItems: 'center' }}>
        <span>wenig</span>{ramp.map((c) => <i key={c} style={{ background: c, width: 18 }} />)}<span>viel</span>
      </div>
      {t.el}
    </div>
  );
}
function HeatRow({ r, cols, ramp, step, onTip, dark }: { r: { label: string; values: Cents[] }; cols: string[]; ramp: string[]; step: (v: number) => number; onTip: ReturnType<typeof useTip>; dark: boolean }) {
  return (
    <>
      <span className="hl">{r.label}</span>
      {r.values.map((v, i) => {
        const s = step(v);
        const bg = s < 0 ? 'var(--surface-2)' : ramp[s];
        const light = dark ? s >= 4 : s <= 2;
        return (
          <span key={i} className="hc num" style={{ background: bg, color: s < 0 ? 'var(--muted)' : light ? (dark ? '#06162d' : '#13203a') : '#fff' }}
            onPointerMove={(e) => onTip.show(e, <TipRows title={`${r.label} · ${cols[i]}`} rows={[{ label: 'Ausgaben', value: v }]} />)} onPointerLeave={onTip.hide}>
            {v > 0 ? Math.round(v / 100) : '·'}
          </span>
        );
      })}
    </>
  );
}

// ---------- Sparkline für Kennzahl-Kacheln ----------
export function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), W = 100, H = 28;
  const x = (i: number) => (W * i) / (values.length - 1);
  const y = (v: number) => H - 3 - ((H - 6) * (v - lo)) / Math.max(1, hi - lo);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" fill={color} />
    </svg>
  );
}
