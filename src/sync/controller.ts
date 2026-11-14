/**
 * Steuert die automatische Synchronisation in der App:
 * beim Start, beim Zurückkehren in die App, bei wiederhergestellter Verbindung,
 * kurz nach eigenen Änderungen und alle 3 Minuten, solange die App sichtbar ist.
 */
import { useSyncExternalStore } from 'react';
import { db } from '../db/schema';
import { AuthError, GoogleDrive } from './drive';
import { SyncEngine, type SyncReport } from './engine';
import { currentToken, preloadGoogle, requireToken } from './auth';

export type Phase = 'off' | 'locked' | 'needs-login' | 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncState { phase: Phase; message?: string; lastReport?: SyncReport }

export const engine = new SyncEngine(new GoogleDrive(requireToken));

let state: SyncState = { phase: 'off' };
const listeners = new Set<() => void>();
function setState(s: SyncState) {
  state = s;
  listeners.forEach((l) => l());
}
export const useSyncState = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);

let busy = false;
let again = false;
let applying = false;

/** Eine Synchronisation anstoßen (still – Fehler landen im Status, nicht als Meldung) */
export async function syncNow(): Promise<SyncReport | null> {
  if (busy) { again = true; return null; }
  const status = await engine.status();
  if (status === 'no-vault') { setState({ phase: 'off' }); return null; }
  if (status === 'locked') { setState({ phase: 'locked' }); return null; }
  if (!(await currentToken())) { setState({ phase: 'needs-login' }); return null; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setState({ phase: 'offline' }); return null; }
  busy = true;
  applying = true;
  setState({ ...state, phase: 'syncing' });
  try {
    const report = await engine.syncOnce();
    setState({ phase: 'idle', lastReport: report });
    return report;
  } catch (e) {
    if (e instanceof AuthError) setState({ phase: 'needs-login' });
    else setState({ phase: navigator.onLine === false ? 'offline' : 'error', message: (e as Error).message });
    return null;
  } finally {
    applying = false;
    busy = false;
    if (again) { again = false; setTimeout(syncNow, 500); }
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
function onLocalChange() {
  if (applying) return; // eingehende Daten der Synchronisation selbst
  clearTimeout(debounce);
  debounce = setTimeout(syncNow, 4000);
}

let started = false;
/** Einmalig beim App-Start aufrufen */
export function startAutoSync() {
  if (started) return;
  started = true;
  for (const t of ['transactions', 'accounts', 'categories', 'recurring', 'pots', 'budgets', 'merchants'] as const) {
    const table = db.table(t);
    table.hook('creating', onLocalChange);
    table.hook('updating', onLocalChange);
    table.hook('deleting', onLocalChange);
  }
  engine.status().then((s) => { if (s !== 'no-vault') preloadGoogle(); });
  syncNow();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 3 * 60_000);
}
