import { useEffect, useRef } from 'react';
import { currentMonth, monthShort, monthsOfYear, yearOf, type Month } from '../lib/dates';

/** Monatsleiste zum Wischen: Vorjahr ‹ Jan … Dez › Folgejahr */
export function MonthStrip({ month, onChange }: { month: Month; onChange: (m: Month) => void }) {
  const y = yearOf(month);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [month]);
  const cm = currentMonth();
  return (
    <div className="monthstrip" ref={ref} role="tablist" aria-label="Monat wählen">
      <button className="yr" onClick={() => onChange(`${y - 1}-12`)} aria-label="Vorjahr">‹ {y - 1}</button>
      {monthsOfYear(y).map((m) => (
        <button key={m} role="tab" aria-selected={m === month} className={m === month ? 'on' : ''} onClick={() => onChange(m)}>
          {monthShort(m)}{m === cm ? ' •' : ''}
        </button>
      ))}
      <button className="yr" onClick={() => onChange(`${y + 1}-01`)} aria-label="Folgejahr">{y + 1} ›</button>
    </div>
  );
}
