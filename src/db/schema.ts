import Dexie, { type Table } from 'dexie';
import type { Cents } from '../lib/money';
import type { Day, Month } from '../lib/dates';

/** Gemeinsame Felder aller Datensätze – Grundlage für die spätere Synchronisation (Phase 6). */
export interface SyncMeta {
  id: string;
  updatedAt: string; // ISO-Zeitstempel der letzten Änderung
  deviceId: string; // Gerät, das zuletzt geändert hat
  deleted?: 0 | 1; // Löschen = Markierung, nie physisch. Neue Datensätze erhalten immer 0 (siehe stamp()).
}

export type AccountKind = 'giro' | 'tagesgeld' | 'depot' | 'bar';
export interface Account extends SyncMeta {
  name: string;
  kind: AccountKind;
  /** Mindestbestand, z. B. Notgroschen 2.000 € auf dem Tagesgeld */
  floor?: Cents;
  /** Das Konto, über das der Monatshaushalt läuft (genau eines) */
  isBudget?: 0 | 1;
  order: number;
}

export type CategoryGroup = 'expense' | 'income' | 'bill';
export interface Category extends SyncMeta {
  name: string;
  group: CategoryGroup;
  parentId?: string; // Unterkategorie
  icon?: string;
  color?: string; // feste Farbe der Hauptkategorie (folgt der Kategorie, nie dem Rang)
  archived?: 0 | 1;
  order: number;
}

export type Interval = 'monthly' | 'quarterly' | 'yearly';
export interface PriceVersion {
  from: Month;
  amount: Cents;
}
/** Fixkosten-Vorlage. Erzeugt jeden fälligen Monat automatisch eine offene Buchung. */
export interface Recurring extends SyncMeta {
  name: string;
  categoryId: string;
  interval: Interval;
  /** Fälligkeitsmonate bei quarterly/yearly (1–12) */
  dueMonths?: number[];
  dueDay: number;
  start: Month;
  end?: Month;
  /** Preis-Historie: der jeweils letzte Eintrag mit from <= Monat gilt */
  prices: PriceVersion[];
  kindLabel?: 'abo' | 'vertrag' | 'rate' | 'familie' | 'sonstiges';
}

/** Rücklagen-Topf auf dem Tagesgeld (z. B. Auto, Heizöl, Urlaub, Jahresbeiträge) */
export interface Pot extends SyncMeta {
  name: string;
  accountId: string;
  yearlyAmount: Cents;
  /** Monatsrate; wenn leer → Jahresbetrag / 12 */
  monthlyRate?: Cents;
  dueMonths: number[];
  start: Month;
  openingBalance: Cents;
  archived?: 0 | 1;
  order: number;
}

export type TxKind = 'income' | 'expense' | 'bill' | 'transfer';
export interface Transaction extends SyncMeta {
  kind: TxKind;
  date: Day;
  /** Budgetmonat (bei Einnahmen ggf. Folgemonat, bei Fixkosten der Fälligkeitsmonat) */
  month: Month;
  amount: Cents; // positiv; Gutschriften bei Ausgaben negativ
  accountId: string;
  toAccountId?: string; // nur bei transfer
  categoryId?: string;
  text?: string;
  merchant?: string;
  tripId?: string; // mehrere Läden einer Einkaufstour
  recurringId?: string;
  potId?: string; // Topf-Rate (bill) oder aus Topf bezahlt (expense)
  paid?: 0 | 1; // Häkchen bei Fixkosten
  source?: string; // Herkunft (z. B. Excel-Import)
}

export interface Budget extends SyncMeta {
  month: Month;
  categoryId: string;
  plan: Cents;
}

export interface MerchantRule extends SyncMeta {
  pattern: string; // Kleinbuchstaben, Teilwort
  label: string; // Anzeigename (Chip)
  categoryId: string;
  quick?: 0 | 1; // als Schnellwahl-Chip anzeigen
  order: number;
}

/**
 * Einstellungen sind bewusst GERÄTEBEZOGEN und werden nicht synchronisiert
 * (z. B. Geräte-ID, Darstellung, Startmonat). Daher keine Sync-Felder.
 */
export interface Setting {
  key: string;
  value: unknown;
}

export class HaushaltDB extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  recurring!: Table<Recurring, string>;
  pots!: Table<Pot, string>;
  transactions!: Table<Transaction, string>;
  budgets!: Table<Budget, string>;
  merchants!: Table<MerchantRule, string>;
  settings!: Table<Setting, string>;

  constructor(name = 'haushaltsbuch') {
    super(name);
    this.version(1).stores({
      accounts: 'id, updatedAt',
      categories: 'id, group, parentId, updatedAt',
      recurring: 'id, updatedAt',
      pots: 'id, updatedAt',
      transactions: 'id, month, date, kind, categoryId, recurringId, potId, tripId, updatedAt',
      budgets: 'id, month, [month+categoryId], updatedAt',
      merchants: 'id, updatedAt',
      settings: 'key'
    });
  }
}

export let db = new HaushaltDB();

/** Nur für Tests: eigene Datenbank verwenden */
export function useTestDb(name: string) {
  db = new HaushaltDB(name);
  return db;
}

/** Nur für Tests: zwischen simulierten Geräten umschalten */
export function setDb(instance: HaushaltDB) {
  db = instance;
}

/** Zeitstempel für automatisch erzeugte Datensätze (Startdaten, Fixkosten-Instanzen):
 *  so alt, dass jede echte Änderung auf irgendeinem Gerät beim Synchronisieren gewinnt. */
export const GENESIS = '2000-01-01T00:00:00.000Z';

/** Tabellen, die zwischen Geräten synchronisiert werden (Einstellungen nicht) */
export const SYNC_TABLES = ['accounts', 'categories', 'recurring', 'pots', 'transactions', 'budgets', 'merchants'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
