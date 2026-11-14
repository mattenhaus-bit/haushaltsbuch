/**
 * Öffentliche Konfiguration. Die OAuth-Client-ID ist kein Geheimnis und darf im Frontend stehen.
 * Der Clientschlüssel (Client Secret) wird NICHT benötigt und gehört niemals in dieses Projekt.
 */
export const GOOGLE_CLIENT_ID = '947450968285-qq4mk2cuk1mphc9umj80kspfntt4ke4s.apps.googleusercontent.com';

/** Nur der versteckte App-Ordner – die App sieht keine anderen Dateien in Google Drive */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
