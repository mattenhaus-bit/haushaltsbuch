import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from './db/schema';
import * as A from './db/actions';
import { seedIfEmpty } from './db/seed';
import { initClock } from './db/meta';
import { addMonths, currentMonth, type Month } from './lib/dates';
import { useAppData } from './data';
import { EntrySheet, type EntryMode } from './components/EntrySheet';
import { Toast } from './components/ui';
import { UpdateBar } from './components/UpdateBar';
import { startAutoSync } from './sync/controller';
import { Overview } from './screens/Overview';
import { Transactions } from './screens/Transactions';
import { Bills } from './screens/Bills';
import { Year } from './screens/Year';
import { More } from './screens/More';
import { IcBills, IcHome, IcList, IcMore, IcPlus, IcYear } from './components/Icons';
import type { JSX } from 'react';

type Screen = 'overview' | 'tx' | 'bills' | 'year' | 'more';
export interface EntryPreset { mode: EntryMode; from?: string; to?: string; amount?: number; text?: string }

const NAV: [Screen, () => JSX.Element, string][] = [
  ['overview', IcHome, 'Monat'],
  ['tx', IcList, 'Buchungen'],
  ['bills', IcBills, 'Fixkosten'],
  ['year', IcYear, 'Jahr'],
  ['more', IcMore, 'Mehr']
];

/** Nur in der Vorschau: Testdaten aus der Excel 2026 laden (Datei ist nicht Teil des Repos) */
async function loadPreviewData() {
  if (!import.meta.env.VITE_PREVIEW) return;
  if (await A.getSetting('demoLoaded', false)) return;
  // Private Dateien (nicht im Repository): Startdaten und Testbuchungen
  const files = { ...import.meta.glob('../privat/startdaten.json', { query: '?raw', import: 'default' }), ...import.meta.glob('./demo/demo-data.json', { query: '?raw', import: 'default' }) };
  for (const load of Object.values(files)) await A.mergeImport((await load()) as string);
  await A.setSetting('demoLoaded', true);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('overview');
  const [month, setMonth] = useState<Month>(currentMonth());
  const [entry, setEntry] = useState<EntryPreset | null>(null);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const d = useAppData();

  useEffect(() => {
    (async () => {
      await initClock(); // Zeitstempel bleiben auch nach Uhr-Umstellungen streng steigend
      await seedIfEmpty();
      await loadPreviewData();
      await A.ensureMonth(currentMonth());
      // Speicher als „dauerhaft“ anfragen (verringert das Risiko, dass der Browser Daten löscht)
      try { await navigator.storage?.persist?.(); } catch { /* nicht unterstützt */ }
      setReady(true);
      if (!import.meta.env.VITE_PREVIEW) startAutoSync(); // Vorschau-Datei synchronisiert nie
    })();
  }, []);

  useEffect(() => {
    if (ready && month <= addMonths(currentMonth(), 1)) A.ensureMonth(month);
  }, [month, ready]);

  const theme = (d?.settings.theme as string) ?? 'system';
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const saved = useCallback((msg: string) => { setEntry(null); setEditTx(null); setToast(msg); }, []);
  const clearToast = useCallback(() => setToast(null), []);

  if (!ready || !d) return <div className="empty" style={{ paddingTop: 80 }}>Lade Haushaltsbuch …</div>;

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand"><i>€</i>Haushaltsbuch</div>
        {NAV.slice(0, 2).map(([s, Ic, l]) => (
          <button key={s} className={screen === s ? 'active' : ''} onClick={() => setScreen(s)} aria-current={screen === s ? 'page' : undefined}><Ic /><span className="lbl">{l}</span></button>
        ))}
        <button className="add" onClick={() => setEntry({ mode: 'expense' })} aria-label="Neue Buchung"><span className="plus"><IcPlus /></span></button>
        {NAV.slice(2).map(([s, Ic, l]) => (
          <button key={s} className={screen === s ? 'active' : ''} onClick={() => setScreen(s)} aria-current={screen === s ? 'page' : undefined}><Ic /><span className="lbl">{l}</span></button>
        ))}
      </nav>
      <main className="main">
        {import.meta.env.VITE_PREVIEW && (
          <div className="banner">Vorschau: Jan–Okt 2026 sind <b>Testdaten aus deiner Excel</b> (vorläufig, ungeprüft). Daten bleiben nur in diesem Browser, bitte noch nichts Echtes pflegen.</div>
        )}
        {screen === 'overview' && <Overview d={d} month={month} setMonth={setMonth} openEntry={setEntry} go={setScreen} onEdit={setEditTx} />}
        {screen === 'tx' && <Transactions d={d} month={month} setMonth={setMonth} onEdit={setEditTx} />}
        {screen === 'bills' && <Bills d={d} month={month} setMonth={setMonth} onEdit={setEditTx} />}
        {screen === 'year' && <Year d={d} />}
        {screen === 'more' && <More d={d} toast={setToast} />}
      </main>
      {entry && <EntrySheet d={d} mode={entry.mode} preset={entry} onClose={() => setEntry(null)} onSaved={saved} />}
      {editTx && <EntrySheet d={d} edit={editTx} onClose={() => setEditTx(null)} onSaved={saved} />}
      {toast && <Toast text={toast} onDone={clearToast} />}
      <UpdateBar />
    </div>
  );
}
