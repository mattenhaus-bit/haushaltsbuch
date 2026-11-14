/**
 * Alle Auswertungen werden aus den Buchungen berechnet – nichts wird als Summe gespeichert.
 * Grundformel (Zero-Based wie in der Excel-Datei, erweitert um Umbuchungen):
 *   Verfügbar = Einnahmen + Entnahmen − Fixkosten (inkl. Topf-Raten) − Ausgaben − Sparen/Investieren
 * Gezählt wird nur, was über das Haushaltskonto (Girokonto) läuft.
 * Ausgaben, die aus einem Topf bezahlt werden, belasten den Monat deshalb nicht.
 */
import type { Account, Category, Pot, Transaction } from '../db/schema';
import { addMonths, compareMonth, type Month } from './dates';
import { sum, type Cents } from './money';

export interface MonthSummary {
  month: Month;
  income: Cents;
  bills: Cents; // alle fälligen Fixkosten inkl. Topf-Raten (bezahlt + offen)
  billsPaid: Cents;
  billsOpen: Cents;
  potRates: Cents; // davon Topf-Raten
  expenses: Cents; // flexible Ausgaben vom Haushaltskonto
  potFunded: Cents; // aus Töpfen bezahlt (nur Info)
  withdrawals: Cents; // Umbuchungen auf das Haushaltskonto (z. B. aus Tagesgeld)
  savedOrInvested: Cents; // Umbuchungen vom Haushaltskonto weg (Tagesgeld, Depot)
  available: Cents;
  byCategory: Map<string, Cents>; // Ausgaben je (Unter-)Kategorie
}

export function budgetAccountId(accounts: Account[]): string | undefined {
  return accounts.find((a) => a.isBudget && !a.deleted)?.id ?? accounts.find((a) => a.kind === 'giro')?.id;
}

export function summarizeMonth(month: Month, txs: Transaction[], budgetAcc: string | undefined): MonthSummary {
  const live = txs.filter((t) => !t.deleted && t.month === month);
  const inc = live.filter((t) => t.kind === 'income' && t.accountId === budgetAcc);
  const bills = live.filter((t) => t.kind === 'bill');
  const exp = live.filter((t) => t.kind === 'expense' && t.accountId === budgetAcc);
  const potExp = live.filter((t) => t.kind === 'expense' && t.accountId !== budgetAcc);
  const tin = live.filter((t) => t.kind === 'transfer' && t.toAccountId === budgetAcc && t.accountId !== budgetAcc);
  const tout = live.filter((t) => t.kind === 'transfer' && t.accountId === budgetAcc && t.toAccountId !== budgetAcc);

  const byCategory = new Map<string, Cents>();
  for (const t of exp) {
    const k = t.categoryId ?? 'unbekannt';
    byCategory.set(k, (byCategory.get(k) ?? 0) + t.amount);
  }
  const s = {
    income: sum(inc, (t) => t.amount),
    bills: sum(bills, (t) => t.amount),
    billsPaid: sum(bills.filter((t) => t.paid), (t) => t.amount),
    potRates: sum(bills.filter((t) => t.potId), (t) => t.amount),
    expenses: sum(exp, (t) => t.amount),
    potFunded: sum(potExp, (t) => t.amount),
    withdrawals: sum(tin, (t) => t.amount),
    savedOrInvested: sum(tout, (t) => t.amount)
  };
  return {
    month,
    ...s,
    billsOpen: s.bills - s.billsPaid,
    available: s.income + s.withdrawals - s.bills - s.expenses - s.savedOrInvested,
    byCategory
  };
}

/** Fasst Unterkategorien zur Hauptkategorie zusammen */
export function rollupToMain(byCategory: Map<string, Cents>, cats: Category[]): Map<string, Cents> {
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId ?? c.id]));
  const out = new Map<string, Cents>();
  for (const [id, v] of byCategory) {
    const main = parentOf.get(id) ?? id;
    out.set(main, (out.get(main) ?? 0) + v);
  }
  return out;
}

/** Plan-Vorschlag: Durchschnitt der letzten 3 Monate mit Daten (Hauptkategorie) */
export function planSuggestion(month: Month, txs: Transaction[], cats: Category[], budgetAcc: string | undefined): Map<string, Cents> {
  const sums: Map<string, Cents>[] = [];
  for (let i = 1; i <= 3; i++) {
    const m = addMonths(month, -i);
    const s = summarizeMonth(m, txs, budgetAcc);
    if (s.expenses !== 0) sums.push(rollupToMain(s.byCategory, cats));
  }
  const out = new Map<string, Cents>();
  if (!sums.length) return out;
  for (const m of sums) for (const [k, v] of m) out.set(k, (out.get(k) ?? 0) + v);
  for (const [k, v] of out) out.set(k, Math.round(v / sums.length));
  return out;
}

export interface PotStatus {
  pot: Pot;
  balance: Cents;
  paidIn: Cents;
  paidOut: Cents;
}

/** Topfstand = Anfangsbestand + bezahlte Raten − aus dem Topf bezahlte Ausgaben (bis einschließlich Monat) */
export function potStatus(pot: Pot, txs: Transaction[], upTo?: Month): PotStatus {
  const rel = txs.filter((t) => !t.deleted && t.potId === pot.id && (!upTo || compareMonth(t.month, upTo) <= 0));
  const paidIn = sum(rel.filter((t) => t.kind === 'bill' && t.paid), (t) => t.amount) + sum(rel.filter((t) => t.kind === 'transfer'), (t) => t.amount);
  const paidOut = sum(rel.filter((t) => t.kind === 'expense'), (t) => t.amount);
  return { pot, paidIn, paidOut, balance: pot.openingBalance + paidIn - paidOut };
}
