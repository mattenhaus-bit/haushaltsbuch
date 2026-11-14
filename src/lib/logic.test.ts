/**
 * Tests der Rechenlogik – ausschließlich mit frei erfundenen Beispielwerten.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseEuro } from './money';
import { addMonths, budgetMonthForIncome, dayInMonth } from './dates';
import { isDue, priceFor } from './recurring';
import { summarizeMonth, potStatus, planSuggestion } from './calc';
import { useTestDb, type Recurring } from '../db/schema';
import { seedIfEmpty } from '../db/seed';
import * as A from '../db/actions';

describe('Beträge', () => {
  it('liest deutsche und englische Schreibweisen', () => {
    expect(parseEuro('12,5')).toBe(1250);
    expect(parseEuro('1.234,56')).toBe(123456);
    expect(parseEuro('12.50')).toBe(1250);
    expect(parseEuro('9,5')).toBe(950);
    expect(parseEuro('-19,99')).toBe(-1999); // Gutschrift
    expect(parseEuro('1.234')).toBe(123400);
    expect(parseEuro('abc')).toBeNull();
    expect(parseEuro('')).toBeNull();
  });
});

describe('Datum', () => {
  it('Einnahme ab dem Stichtag zählt für den Folgemonat', () => {
    expect(budgetMonthForIncome('2030-03-27', 25)).toBe('2030-04');
    expect(budgetMonthForIncome('2030-12-29', 25)).toBe('2031-01');
    expect(budgetMonthForIncome('2030-03-03', 25)).toBe('2030-03');
    expect(budgetMonthForIncome('2030-03-28', 0)).toBe('2030-03');
  });
  it('Monatsrechnung und Monatsende', () => {
    expect(addMonths('2030-12', 1)).toBe('2031-01');
    expect(addMonths('2030-01', -1)).toBe('2029-12');
    expect(dayInMonth('2030-02', 31)).toBe('2030-02-28');
  });
});

describe('Fixkosten-Vorlagen', () => {
  const miete = { interval: 'monthly', start: '2030-01', prices: [{ from: '2030-01', amount: 90000 }, { from: '2030-07', amount: 95000 }] } as Recurring;
  it('Preis-Historie', () => {
    expect(priceFor(miete, '2030-06')).toBe(90000);
    expect(priceFor(miete, '2030-07')).toBe(95000);
    expect(priceFor(miete, '2031-01')).toBe(95000);
  });
  it('vor dem ersten Preis gilt 0 € (kein rückwirkender Preis)', () => {
    const r = { interval: 'monthly', start: '2030-01', prices: [{ from: '2030-04', amount: 5000 }] } as Recurring;
    expect(priceFor(r, '2030-02')).toBe(0);
    expect(priceFor(r, '2030-04')).toBe(5000);
  });
  it('Fälligkeit: Ende, quartalsweise', () => {
    const vertrag = { interval: 'monthly', start: '2030-01', end: '2030-05', prices: [] } as unknown as Recurring;
    expect(isDue(vertrag, '2030-05')).toBe(true);
    expect(isDue(vertrag, '2030-06')).toBe(false);
    const q = { interval: 'quarterly', start: '2030-01', dueMonths: [1, 4, 7, 10], prices: [] } as unknown as Recurring;
    expect(isDue(q, '2030-04')).toBe(true);
    expect(isDue(q, '2030-05')).toBe(false);
  });
});

describe('Monatsrechnung mit Datenbank (Beispieldaten)', () => {
  let n = 0;
  beforeEach(async () => {
    useTestDb(`test-${n++}`);
    await seedIfEmpty();
    await A.setSetting('startMonth', '2030-01');
    // frei erfundene Beispiel-Fixkosten und ein Topf
    await A.saveRecurring({ id: 'rec-miete', name: 'Miete', categoryId: 'bill-wohnen', interval: 'monthly', dueDay: 1, start: '2030-01', prices: [{ from: '2030-01', amount: 90000 }] });
    await A.saveRecurring({ id: 'rec-handy', name: 'Handyvertrag', categoryId: 'bill-abos', interval: 'monthly', dueDay: 15, start: '2030-01', prices: [{ from: '2030-01', amount: 1500 }] });
    await A.saveRecurring({ id: 'rec-vers', name: 'Versicherung', categoryId: 'bill-versicherung', interval: 'yearly', dueMonths: [3], dueDay: 1, start: '2030-01', prices: [{ from: '2030-01', amount: 12000 }] });
    await A.savePot({ id: 'pot-auto', name: 'Auto', accountId: 'acc-tagesgeld', yearlyAmount: 120000, dueMonths: [5], start: '2030-01' });
  });

  it('legt Fixkosten und Topf-Raten genau einmal an', async () => {
    expect(await A.ensureMonth('2030-03')).toBe(4); // Miete, Handy, Versicherung, Topf-Rate
    expect(await A.ensureMonth('2030-03')).toBe(0);
  });

  it('gelöschte Fixkosten-Instanz wird nicht neu erzeugt', async () => {
    const { db } = await import('../db/schema');
    await A.ensureMonth('2030-02');
    await A.deleteTx('rec:rec-handy:2030-02');
    await A.ensureMonth('2030-02');
    expect((await db.transactions.get('rec:rec-handy:2030-02'))?.deleted).toBe(1);
  });

  it('Zero-Based: Verfügbar, Topf-Ausgabe belastet den Monat nicht, Umbuchungen', async () => {
    const { db } = await import('../db/schema');
    await A.ensureMonth('2030-02');
    const base = summarizeMonth('2030-02', await db.transactions.toArray(), 'acc-giro');
    expect(base.bills).toBe(90000 + 1500 + 10000); // Miete + Handy + Topf-Rate (1.200 € / 12)
    expect(base.potRates).toBe(10000);

    await A.addIncome({ amount: 250000, categoryId: 'inc-gehalt', date: '2030-01-28' }); // zählt für Februar
    await A.addTrip('2030-02-04', [{ merchant: 'Aldi', amount: 4500 }, { merchant: 'Lidl', amount: 6000 }, { merchant: 'Aral', amount: 5000 }]);
    await A.addExpense({ amount: 30000, date: '2030-02-10', text: 'Werkstatt', categoryId: 'exp-mobilitaet-auto', potId: 'pot-auto' });
    await A.addTransfer({ from: 'acc-giro', to: 'acc-depot', amount: 20000, date: '2030-02-27' });

    const txs = await db.transactions.toArray();
    const s = summarizeMonth('2030-02', txs, 'acc-giro');
    expect(s.income).toBe(250000);
    expect(s.expenses).toBe(4500 + 6000 + 5000);
    expect(s.potFunded).toBe(30000);
    expect(s.savedOrInvested).toBe(20000);
    expect(s.available).toBe(250000 - 101500 - 15500 - 20000);
    expect(s.byCategory.get('exp-lebensmittel-supermarkt')).toBe(10500);
    expect(s.byCategory.get('exp-mobilitaet-tanken')).toBe(5000);
    const pot = (await db.pots.get('pot-auto'))!;
    expect(potStatus(pot, txs).balance).toBe(-30000);
    await A.togglePaid('pot:pot-auto:2030-02');
    expect(potStatus(pot, await db.transactions.toArray()).balance).toBe(10000 - 30000);
  });

  it('Entnahme aus Tagesgeld gleicht Minus-Monat aus', async () => {
    const { db } = await import('../db/schema');
    await A.addExpense({ amount: 50000, date: '2030-06-10', categoryId: 'exp-urlaub' });
    await A.addTransfer({ from: 'acc-tagesgeld', to: 'acc-giro', amount: 50000, date: '2030-06-30' });
    const s = summarizeMonth('2030-06', await db.transactions.toArray(), 'acc-giro');
    expect(s.withdrawals).toBe(50000);
    expect(s.available).toBe(0 - s.bills);
  });

  it('Preisänderung passt nur offene Monate an', async () => {
    const { db } = await import('../db/schema');
    await A.ensureMonth('2030-02');
    await A.ensureMonth('2030-03');
    await A.togglePaid('rec:rec-miete:2030-02');
    await A.changePrice('rec-miete', '2030-02', 95000);
    expect((await db.transactions.get('rec:rec-miete:2030-02'))!.amount).toBe(90000); // schon bezahlt
    expect((await db.transactions.get('rec:rec-miete:2030-03'))!.amount).toBe(95000);
  });

  it('Datum ändern verschiebt Umbuchung und Ausgabe in den neuen Monat (auch über Jahreswechsel)', async () => {
    const { db } = await import('../db/schema');
    const t = await A.addTransfer({ from: 'acc-giro', to: 'acc-tagesgeld', amount: 10000, date: '2030-12-30' });
    await A.updateTx(t, { date: '2031-01-02' });
    expect((await db.transactions.get(t))!.month).toBe('2031-01');
    const e = await A.addExpense({ amount: 1000, date: '2030-12-31', categoryId: 'exp-kleidung' });
    await A.updateTx(e, { date: '2031-01-01' });
    expect((await db.transactions.get(e))!.month).toBe('2031-01');
  });

  it('Einnahme behält den ausdrücklich gewählten Budgetmonat', async () => {
    const { db } = await import('../db/schema');
    const i = await A.addIncome({ amount: 1000, categoryId: 'inc-zinsen', date: '2030-03-28', month: '2030-03' });
    await A.updateTx(i, { date: '2030-03-29', month: '2030-03' });
    expect((await db.transactions.get(i))!.month).toBe('2030-03');
  });

  it('Kategorien zusammenführen hängt Buchungen, Fixkosten, Pläne und Läden um', async () => {
    const { db } = await import('../db/schema');
    const { stamp } = await import('../db/meta');
    await A.addExpense({ amount: 1000, date: '2030-02-01', categoryId: 'exp-elektronik' });
    await A.saveRecurring({ id: 'rec-x', name: 'Cloud', categoryId: 'bill-abos', interval: 'monthly', dueDay: 1, start: '2030-01', prices: [{ from: '2030-01', amount: 300 }] });
    await db.budgets.put(await stamp({ month: '2030-02', categoryId: 'exp-elektronik', plan: 5000 }));
    await A.saveMerchant({ pattern: 'technikmarkt', label: 'Technikmarkt', categoryId: 'exp-elektronik' });
    await A.mergeCategory('exp-elektronik', 'exp-sonstiges');
    await A.mergeCategory('bill-abos', 'bill-wohnen');
    expect((await db.transactions.where('categoryId').equals('exp-elektronik').count())).toBe(0);
    expect((await db.recurring.get('rec-x'))!.categoryId).toBe('bill-wohnen');
    expect((await db.budgets.toArray()).every((b) => b.categoryId !== 'exp-elektronik')).toBe(true);
    expect((await db.merchants.toArray()).find((m) => m.label === 'Technikmarkt')!.categoryId).toBe('exp-sonstiges');
    expect((await db.categories.get('exp-elektronik'))!.archived).toBe(1);
  });

  it('jeder Datensatz trägt Sync-Felder (id, updatedAt, deviceId, deleted)', async () => {
    const { db } = await import('../db/schema');
    await A.ensureMonth('2030-02');
    await A.addExpense({ amount: 100, date: '2030-02-01', categoryId: 'exp-kleidung' });
    for (const t of ['accounts', 'categories', 'merchants', 'recurring', 'pots', 'transactions'] as const) {
      for (const r of (await db.table(t).toArray()) as Record<string, unknown>[]) {
        expect(typeof r.id).toBe('string');
        expect(typeof r.updatedAt).toBe('string');
        expect(typeof r.deviceId).toBe('string');
        expect([0, 1]).toContain(r.deleted);
      }
    }
  });

  it('Plan-Vorschlag = Ø der letzten 3 Monate', async () => {
    const { db } = await import('../db/schema');
    await A.addExpense({ amount: 60000, date: '2030-08-05', categoryId: 'exp-lebensmittel-supermarkt' });
    await A.addExpense({ amount: 30000, date: '2030-09-05', categoryId: 'exp-lebensmittel-supermarkt' });
    await A.addExpense({ amount: 45000, date: '2030-10-05', categoryId: 'exp-lebensmittel-bauer-eier' });
    const p = planSuggestion('2030-11', await db.transactions.toArray(), await db.categories.toArray(), 'acc-giro');
    expect(p.get('exp-lebensmittel')).toBe(45000);
  });

  it('Startdaten-Datei wird hinzugefügt, ohne vorhandene Daten zu löschen', async () => {
    const { db } = await import('../db/schema');
    await A.addExpense({ amount: 777, date: '2030-02-01', categoryId: 'exp-kleidung' });
    const file = JSON.stringify({ app: 'haushaltsbuch', kind: 'startdaten', data: {
      recurring: [{ id: 'rec-neu', name: 'Zeitung', categoryId: 'bill-abos', interval: 'monthly', dueDay: 5, start: '2030-01', prices: [{ from: '2030-01', amount: 1200 }], updatedAt: 'x', deviceId: 'y' }]
    } });
    const counts = await A.mergeImport(file);
    expect(counts.recurring).toBe(1);
    expect((await db.recurring.get('rec-neu'))!.deleted).toBe(0);
    expect((await db.transactions.toArray()).some((t) => t.amount === 777)).toBe(true);
  });

  it('Backup: Export und Wiederherstellung', async () => {
    const { db } = await import('../db/schema');
    await A.addExpense({ amount: 1234, date: '2030-02-01', categoryId: 'exp-kleidung' });
    const json = await A.exportBackup();
    await A.addExpense({ amount: 999, date: '2030-02-02', categoryId: 'exp-kleidung' });
    await A.importBackup(json);
    const t = (await db.transactions.toArray()).filter((x) => x.kind === 'expense' && !x.deleted);
    expect(t.length).toBe(1);
    expect(t[0].amount).toBe(1234);
  });
});
