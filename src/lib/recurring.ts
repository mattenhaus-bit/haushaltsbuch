import type { Pot, Recurring } from '../db/schema';
import { compareMonth, monthIndex, type Month } from './dates';
import type { Cents } from './money';

/** Gilt die Vorlage in diesem Monat (zwischen start und end)? */
export function isActive(r: { start: Month; end?: Month }, m: Month): boolean {
  if (compareMonth(m, r.start) < 0) return false;
  if (r.end && compareMonth(m, r.end) > 0) return false;
  return true;
}

/** Ist die Fixkosten-Vorlage in diesem Monat fällig? */
export function isDue(r: Recurring, m: Month): boolean {
  if (!isActive(r, m)) return false;
  if (r.interval === 'monthly') return true;
  const due = r.dueMonths && r.dueMonths.length ? r.dueMonths : [monthIndex(r.start)];
  return due.includes(monthIndex(m));
}

/** Betrag laut Preis-Historie für einen Monat (vor dem ersten Preiseintrag: 0 €, nie rückwirkend) */
export function priceFor(r: Recurring, m: Month): Cents {
  const sorted = [...r.prices].sort((a, b) => compareMonth(a.from, b.from));
  let amount = 0;
  for (const p of sorted) if (compareMonth(p.from, m) <= 0) amount = p.amount;
  return amount;
}

/** Monatsrate eines Topfs */
export function potRate(p: Pot): Cents {
  return p.monthlyRate ?? Math.round(p.yearlyAmount / 12);
}

/** Deterministische IDs: dasselbe Gerät oder ein zweites Gerät erzeugt dieselbe Instanz → keine Duplikate beim Sync */
export const recurringTxId = (recId: string, m: Month) => `rec:${recId}:${m}`;
export const potTxId = (potId: string, m: Month) => `pot:${potId}:${m}`;
