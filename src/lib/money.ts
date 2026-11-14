/** Beträge werden intern als ganze Cent gespeichert, damit keine Rundungsfehler entstehen. */
export type Cents = number;

const fmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const fmtShort = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function euro(c: Cents): string {
  return fmt.format(c / 100);
}

export function euroShort(c: Cents): string {
  return fmtShort.format(c / 100);
}

/** Wandelt eine Eingabe wie "12,5", "1.234,56", "12.50" oder "-3" in Cent um. Gibt null bei ungültiger Eingabe. */
export function parseEuro(input: string): Cents | null {
  let s = input.trim().replace(/€/g, '').replace(/\s/g, '');
  if (!s) return null;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Das spätere Zeichen ist das Dezimaltrennzeichen
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.replace(',', '.');
  } else if (lastDot >= 0) {
    // "1.234" (Tausender) vs. "12.5" (Dezimal): 3 Stellen nach genau einem Punkt = Tausender
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const c = Math.round(parseFloat(s) * 100);
  return neg ? -c : c;
}

/** Cent → Eingabetext "12,50" */
export function centsToInput(c: Cents): string {
  return (c / 100).toFixed(2).replace('.', ',');
}

export function sum<T>(items: T[], f: (x: T) => number): number {
  let s = 0;
  for (const x of items) s += f(x);
  return s;
}
