import { useEffect, useMemo, useState } from 'react';
import { readWorkbook, type Workbook } from '../import/xlsx';
import { analyzeWorkbook, guessYear, looksLikeTemplate, type ImportMode, type ImportResult } from '../import/excel';
import { applyImport, type ImportLogEntry } from '../import/apply';
import { monthLabel } from '../lib/dates';
import { euro, euroShort } from '../lib/money';
import type { AppData } from '../data';
import { Sheet } from '../components/ui';

export function ImportSheet({ d, file, log, onClose, onDone }: { d: AppData; file: File; log: ImportLogEntry[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [wb, setWb] = useState<Workbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [mode, setMode] = useState<ImportMode>('details');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    file.arrayBuffer().then((buf) => {
      try {
        const w = readWorkbook(buf);
        if (!looksLikeTemplate(w)) { setError('Diese Datei hat nicht den Aufbau der Haushaltsbuch-Vorlage (Monatsblätter JAN–DEC und „Kostenstruktur“).'); return; }
        setWb(w);
        setYear(guessYear(w, file.name) ?? new Date().getFullYear());
      } catch (e) { setError(`Die Datei konnte nicht gelesen werden: ${(e as Error).message}`); }
    });
  }, [file]);

  const result: ImportResult | null = useMemo(() => {
    if (!wb) return null;
    return analyzeWorkbook(wb, year, mode, {
      categories: d.categories, recurring: d.recurring, merchants: d.merchants,
      accounts: d.accounts, budgetAcc: d.budgetAcc ?? 'acc-giro', startMonth: (d.settings.startMonth as string) ?? null
    });
  }, [wb, year, mode, d]);

  const allOk = result ? result.months.every((m) => m.ok) : false;
  const existing = log.find((l) => l.year === year);
  const sum = (k: 'income' | 'bills' | 'expenses' | 'debts' | 'savings') => result?.months.reduce((a, m) => a + m.app[k], 0) ?? 0;
  const purchases = result?.txs.filter((t) => t.source?.endsWith('einkaufsliste')).length ?? 0;
  const withdrawals = result?.txs.filter((t) => t.source?.endsWith('einkommen') && t.kind === 'transfer').reduce((a, t) => a + t.amount, 0) ?? 0;

  const take = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const n = await applyImport(result, file.name);
      onDone(`${year} importiert: ${n} Buchungen`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <Sheet title="Excel-Import" onClose={onClose}>
      <p className="small muted" style={{ marginTop: -4 }}>„{file.name}“ wird nur gelesen, nicht verändert. Die Daten verlassen dein Gerät nicht.</p>
      {error && <div className="note" style={{ background: 'color-mix(in srgb, var(--neg) 14%, var(--surface))' }}>{error}</div>}
      {!wb && !error && <div className="empty">Datei wird gelesen …</div>}
      {result && (
        <>
          <div className="flex" style={{ marginBottom: 12 }}>
            <div style={{ width: 110 }}>
              <div className="field" style={{ marginBottom: 0 }}><label htmlFor="imp-year">Jahr</label>
                <select id="imp-year" className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 6 + i).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            <div className="grow">
              <div className="field" style={{ marginBottom: 0 }}><label>Ausgaben übernehmen als</label>
                <div className="seg">
                  <button className={mode === 'details' ? 'on' : ''} onClick={() => setMode('details')}>Einzelkäufe</button>
                  <button className={mode === 'sums' ? 'on' : ''} onClick={() => setMode('sums')}>Monatssummen</button>
                </div>
              </div>
            </div>
          </div>

          <div className="note" style={{ background: allOk ? 'color-mix(in srgb, var(--pos) 14%, var(--surface))' : 'color-mix(in srgb, var(--neg) 14%, var(--surface))', marginBottom: 12 }}>
            {result.months.length === 0
              ? 'In dieser Datei gibt es keine Monate vor dem App-Start zu importieren.'
              : allOk
                ? <><b>✓ Alle {result.months.length} Monate stimmen mit der Excel überein</b> – Einnahmen, Fixkosten, Ausgaben, Schulden, Ersparnisse und Gleichgewicht auf den Cent.</>
                : <><b>Achtung:</b> {result.months.filter((m) => !m.ok).length} Monate weichen ab (siehe Tabelle). Bitte nicht übernehmen und mir Bescheid geben.</>}
          </div>

          <div className="tiles" style={{ marginBottom: 12 }}>
            <div className="tile"><div className="k">Buchungen</div><div className="v num">{result.txs.length}</div><div className="d">{result.months.length} Monate</div></div>
            <div className="tile"><div className="k">Einnahmen</div><div className="v num">{euroShort(sum('income'))}</div><div className="d">wie Excel gezählt{withdrawals ? `, davon ${euroShort(withdrawals)} Entnahme` : ''}</div></div>
            <div className="tile"><div className="k">Ausgaben</div><div className="v num">{euroShort(sum('expenses'))}</div><div className="d">{mode === 'details' ? `${purchases} Einzelkäufe` : 'als Monatssummen'}</div></div>
            <div className="tile"><div className="k">Fixkosten + Raten</div><div className="v num">{euroShort(sum('bills') + sum('debts'))}</div><div className="d">nur abgehakte, wie Excel</div></div>
          </div>

          {mode === 'details' && result.stats.corrections > 0 && (
            <div className="note" style={{ marginBottom: 12 }}>
              Einkaufsliste und Monatsblätter passten in der Excel nicht immer zusammen. Damit die Summen exakt stimmen, legt der Import <b>{result.stats.corrections} Abgleich-Buchungen</b> an (zusammen {euro(result.stats.correctionVolume)} Bewegung).
              {' '}{result.stats.autoCategorized} von {result.stats.journalRows} Einkäufen wurden automatisch einer Kategorie zugeordnet.
              {result.stats.correctionVolume > 500000 && <> Weil der Abgleich hier groß ist, ist <b>„Monatssummen“</b> für dieses Jahr vermutlich übersichtlicher.</>}
            </div>
          )}

          <div className="card" style={{ marginBottom: 12 }}>
            <h2>Prüfbericht je Monat <small>Excel = App</small></h2>
            <div className="scroll-x">
              <table className="matrix num">
                <thead><tr><th>Monat</th><th>Einnahmen</th><th>Fixkosten</th><th>Ausgaben</th><th>Raten</th><th>Gespart</th><th>Gleichgewicht</th><th></th></tr></thead>
                <tbody>
                  {result.months.map((m) => (
                    <tr key={m.month}>
                      <td>{monthLabel(m.month)}</td>
                      {(['income', 'bills', 'expenses', 'debts', 'savings', 'balance'] as const).map((k) => (
                        <td key={k} title={`Excel ${euro(m.excel[k])} · App ${euro(m.app[k])}`} style={{ color: m.excel[k] === m.app[k] ? undefined : 'var(--neg)' }}>{euro(m.app[k])}</td>
                      ))}
                      <td>{m.ok ? '✓' : '✗'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="card tablewrap" style={{ marginBottom: 12 }}>
            <summary>Ausgaben je Kategorie ({year})</summary>
            {result.categoryTotals.filter((c) => c.excel || c.app).map((c) => (
              <div className="row" key={c.categoryId}><span className="grow">{c.label}</span><span className="num">{euro(c.app)}</span><span style={{ width: 22, textAlign: 'right' }}>{c.excel === c.app ? '✓' : '✗'}</span></div>
            ))}
          </details>

          {result.warnings.length > 0 && (
            <details className="card tablewrap" style={{ marginBottom: 12 }}>
              <summary>Hinweise ({result.warnings.length})</summary>
              <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}

          {(result.newCategories.length > 0 || result.newAccounts.length > 0) && (
            <p className="small muted">Wird neu angelegt: {[...result.newCategories.map((c) => `Kategorie „${c.name}“`), ...result.newAccounts.map((a) => `Konto „${a.name}“`)].join(', ')}.</p>
          )}
          {existing && <p className="small" style={{ color: 'var(--warn)' }}>{year} wurde bereits am {new Date(existing.at).toLocaleDateString('de-DE')} importiert. Die Übernahme ersetzt diesen Import (Änderungen an importierten Buchungen von {year} gehen dabei verloren).</p>}
          <p className="small muted">Vor der Übernahme wird automatisch eine Sicherung deiner aktuellen Daten gespeichert. Den Import kannst du später unter „Mehr → Excel-Import“ wieder entfernen.</p>
          <button className="btn primary block" onClick={take} disabled={busy || !allOk || result.months.length === 0}>
            {busy ? 'Wird übernommen …' : `${result.txs.length} Buchungen für ${year} übernehmen`}
          </button>
        </>
      )}
    </Sheet>
  );
}
