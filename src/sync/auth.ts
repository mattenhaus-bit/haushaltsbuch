/**
 * Google-Anmeldung über Google Identity Services (Token-Client, ohne eigenen Server).
 * - Es wird nur ein kurzlebiges Zugriffstoken (ca. 1 Stunde) für den App-Ordner angefordert.
 * - Das Token liegt nur auf diesem Gerät; es gibt kein Refresh-Token und keinen Clientschlüssel.
 * - Läuft es ab, wird automatisch nichts im Hintergrund geöffnet: Die App zeigt „Anmelden“ an,
 *   weil iOS Anmeldefenster nur nach einem Tippen erlaubt.
 */
import { DRIVE_SCOPE, GOOGLE_CLIENT_ID } from '../config';
import { db } from '../db/schema';
import { AuthError } from './drive';

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(opts?: { prompt?: string }): void }
declare global {
  interface Window {
    google?: { accounts: { oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string; message?: string }) => void }): TokenClient;
      revoke(token: string, done?: () => void): void;
    } } };
  }
}

const TOKEN_KEY = 'sync:token';
let memory: { token: string; exp: number } | null = null;
let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoading = null; reject(new Error('Google-Anmeldung konnte nicht geladen werden (offline?)')); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** Vorab laden, damit das Anmeldefenster beim Tippen sofort (synchron) geöffnet werden kann */
export function preloadGoogle() {
  loadGis().catch(() => undefined);
}

async function stored() {
  if (memory) return memory;
  const s = await db.settings.get(TOKEN_KEY);
  memory = (s?.value as typeof memory) ?? null;
  return memory;
}

/** Gültiges Token oder null (öffnet nie ein Fenster) */
export async function currentToken(): Promise<string | null> {
  const t = await stored();
  return t && t.exp - 60_000 > Date.now() ? t.token : null;
}

/** Für Drive-Aufrufe: wirft AuthError, wenn eine neue Anmeldung nötig ist */
export async function requireToken(): Promise<string> {
  const t = await currentToken();
  if (!t) throw new AuthError();
  return t;
}

/** Anmelden – nur aus einem Klick/Tipp heraus aufrufen */
export async function signIn(): Promise<void> {
  await loadGis();
  const oauth2 = window.google!.accounts.oauth2;
  const res = await new Promise<TokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: resolve,
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Anmeldung abgebrochen' : e.type === 'popup_failed_to_open' ? 'Anmeldefenster wurde blockiert' : `Anmeldung fehlgeschlagen (${e.type})`))
    });
    client.requestAccessToken({ prompt: '' });
  });
  if (!res.access_token) throw new Error(res.error_description || res.error || 'Anmeldung fehlgeschlagen');
  memory = { token: res.access_token, exp: Date.now() + (res.expires_in ?? 3600) * 1000 };
  await db.settings.put({ key: TOKEN_KEY, value: memory });
}

export async function signOut() {
  const t = await stored();
  memory = null;
  await db.settings.delete(TOKEN_KEY);
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.token);
}
