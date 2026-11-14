/**
 * Tresor-Verschlüsselung (nur Web Crypto API, keine Fremdbibliothek).
 *
 * - Alle Daten in Google Drive sind mit einem zufälligen Datenschlüssel (AES-256-GCM) verschlüsselt.
 * - Der Datenschlüssel liegt in Drive nur „eingepackt“ (wrapped) vor:
 *   einmal mit dem Tresor-Passwort, einmal mit dem Wiederherstellungsschlüssel
 *   (beides über PBKDF2-SHA-256 mit zufälligem Salt).
 * - Passwort, Wiederherstellungsschlüssel und Datenschlüssel verlassen das Gerät nie im Klartext.
 * - Auf dem Gerät wird der Datenschlüssel als NICHT exportierbarer CryptoKey gespeichert.
 */

export const PBKDF2_ITERATIONS = 600_000;
/** Aktuelle Iterationszahl für neue Verpackungen (Tests dürfen sie senken, um schneller zu laufen) */
export const kdf = { iterations: PBKDF2_ITERATIONS };
const MAGIC = new TextEncoder().encode('HB1'); // Dateikennung + Formatversion

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export const toB64 = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Schlüssel aus Passwort ableiten (zum Ein-/Auspacken des Datenschlüssels) */
export async function deriveKek(secret: string, salt: Uint8Array, iterations = kdf.iterations): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

export async function generateDataKey(): Promise<CryptoKey> {
  // extractable nur, damit er einmalig eingepackt werden kann; lokal wird eine nicht exportierbare Kopie gespeichert
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export interface WrappedKey { salt: string; iv: string; data: string; iterations: number }

export async function wrapDataKey(dek: CryptoKey, secret: string, iterations = kdf.iterations): Promise<WrappedKey> {
  const salt = randomBytes(16), iv = randomBytes(12);
  const kek = await deriveKek(secret, salt, iterations);
  const data = new Uint8Array(await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv: iv as BufferSource }));
  return { salt: toB64(salt), iv: toB64(iv), data: toB64(data), iterations };
}

/** Packt den Datenschlüssel aus. Falsches Passwort → Fehler „Passwort falsch“. */
export async function unwrapDataKey(w: WrappedKey, secret: string): Promise<CryptoKey> {
  const kek = await deriveKek(secret, fromB64(w.salt), w.iterations);
  try {
    return await subtle().unwrapKey('raw', fromB64(w.data) as BufferSource, kek, { name: 'AES-GCM', iv: fromB64(w.iv) as BufferSource }, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } catch {
    throw new Error('Passwort bzw. Wiederherstellungsschlüssel ist falsch.');
  }
}

/** Nicht exportierbare Kopie eines Schlüssels (für die lokale Speicherung) */
export async function nonExtractable(dek: CryptoKey): Promise<CryptoKey> {
  const raw = await subtle().exportKey('raw', dek);
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Verschlüsselt ein JSON-Objekt: Ausgabe = "HB1" | IV (12) | Chiffrat (inkl. Prüfsumme) */
export async function encryptJson(dek: CryptoKey, value: unknown): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: MAGIC as BufferSource }, dek, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length);
  out.set(MAGIC, 0); out.set(iv, MAGIC.length); out.set(ct, MAGIC.length + iv.length);
  return out;
}

export async function decryptJson<T>(dek: CryptoKey, bytes: Uint8Array): Promise<T> {
  if (bytes.length < 3 + 12 + 16 || dec.decode(bytes.slice(0, 3)) !== 'HB1') throw new Error('Unbekanntes Dateiformat');
  const iv = bytes.slice(3, 15), ct = bytes.slice(15);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: MAGIC as BufferSource }, dek, ct as BufferSource);
  } catch {
    throw new Error('Datei konnte nicht entschlüsselt werden (falscher Schlüssel oder beschädigt).');
  }
  return JSON.parse(dec.decode(plain)) as T;
}

/** Wiederherstellungsschlüssel: 24 Zeichen (≈ 120 Bit), gut lesbar, in 4er-Gruppen */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I
export function generateRecoveryKey(): string {
  const b = randomBytes(24);
  const chars = [...b].map((x) => ALPHABET[x % 32]).join('');
  return chars.match(/.{4}/g)!.join('-');
}
export const normalizeRecoveryKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g)?.join('-') ?? '';

/** Öffentliche Tresor-Datei in Drive (enthält nur eingepackte Schlüssel, keine Daten) */
export interface VaultFile {
  app: 'haushaltsbuch';
  version: 1;
  createdAt: string;
  byPassword: WrappedKey;
  byRecovery: WrappedKey;
  /** verschlüsselter Prüfwert, um ein falsches Passwort sicher zu erkennen */
  check: string;
}

export async function createVault(password: string): Promise<{ vault: VaultFile; dek: CryptoKey; recoveryKey: string }> {
  const dek = await generateDataKey();
  const recoveryKey = generateRecoveryKey();
  const vault: VaultFile = {
    app: 'haushaltsbuch', version: 1, createdAt: new Date().toISOString(),
    byPassword: await wrapDataKey(dek, password),
    byRecovery: await wrapDataKey(dek, normalizeRecoveryKey(recoveryKey)),
    check: toB64(await encryptJson(dek, { ok: 'haushaltsbuch' }))
  };
  return { vault, dek: await nonExtractable(dek), recoveryKey };
}

/** Öffnet den Tresor mit dem Passwort ODER dem Wiederherstellungsschlüssel */
export async function openVault(vault: VaultFile, secret: string): Promise<CryptoKey> {
  let dek: CryptoKey;
  try {
    dek = await unwrapDataKey(vault.byPassword, secret);
  } catch (e) {
    const rk = normalizeRecoveryKey(secret);
    if (rk.length !== 29) throw e;
    dek = await unwrapDataKey(vault.byRecovery, rk);
  }
  await decryptJson(dek, fromB64(vault.check)); // zusätzliche Prüfung
  return dek;
}

async function unwrapExtractable(w: WrappedKey, secret: string): Promise<CryptoKey> {
  const kek = await deriveKek(secret, fromB64(w.salt), w.iterations);
  return subtle().unwrapKey('raw', fromB64(w.data) as BufferSource, kek, { name: 'AES-GCM', iv: fromB64(w.iv) as BufferSource }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Passwort ändern (mit altem Passwort ODER Wiederherstellungsschlüssel):
 *  nur die Verpackung des Datenschlüssels wird ersetzt, die Daten bleiben unverändert. */
export async function changeVaultPassword(vault: VaultFile, oldSecret: string, newPassword: string): Promise<VaultFile> {
  let dek: CryptoKey;
  try {
    dek = await unwrapExtractable(vault.byPassword, oldSecret);
  } catch {
    const rk = normalizeRecoveryKey(oldSecret);
    if (rk.length !== 29) throw new Error('Altes Passwort ist falsch.');
    dek = await unwrapExtractable(vault.byRecovery, rk).catch(() => { throw new Error('Altes Passwort bzw. Wiederherstellungsschlüssel ist falsch.'); });
  }
  return { ...vault, byPassword: await wrapDataKey(dek, newPassword) };
}
