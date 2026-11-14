/** Monate werden als "YYYY-MM", Tage als "YYYY-MM-DD" gespeichert (lokale Zeit). */
export type Month = string;
export type Day = string;

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const pad = (n: number) => String(n).padStart(2, '0');

export function today(): Day {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthOf(day: Day): Month {
  return day.slice(0, 7);
}

export function currentMonth(): Month {
  return monthOf(today());
}

export function addMonths(m: Month, n: number): Month {
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthIndex(m: Month): number {
  return Number(m.slice(5, 7));
}

export function yearOf(m: Month): number {
  return Number(m.slice(0, 4));
}

export function monthLabel(m: Month): string {
  return `${MONTHS_DE[monthIndex(m) - 1]} ${yearOf(m)}`;
}

export function monthShort(m: Month): string {
  return MONTHS_SHORT[monthIndex(m) - 1];
}

export function monthsOfYear(year: number): Month[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
}

export function dayLabel(d: Day): string {
  const [y, m, dd] = d.split('-');
  return `${dd}.${m}.${y}`;
}

export function daysInMonth(m: Month): number {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
}

/** Tag im Monat, gekappt auf die Monatslänge (z. B. Fälligkeit 31. im Februar → 28./29.) */
export function dayInMonth(m: Month, day: number): Day {
  return `${m}-${pad(Math.min(Math.max(day, 1), daysInMonth(m)))}`;
}

/**
 * Budgetmonat einer Einnahme: Gehalt, das ab dem Stichtag (Standard 25.) eingeht,
 * zählt für den Folgemonat (Entscheidung 13.11.2026).
 */
export function budgetMonthForIncome(day: Day, shiftFromDay: number): Month {
  const m = monthOf(day);
  const d = Number(day.slice(8, 10));
  return shiftFromDay > 0 && d >= shiftFromDay ? addMonths(m, 1) : m;
}

export function compareMonth(a: Month, b: Month): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
