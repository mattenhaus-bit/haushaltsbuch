/**
 * Zugriff auf den versteckten App-Ordner („appDataFolder“) in Google Drive.
 * Die App sieht ausschließlich diesen Ordner (Scope drive.appdata) – keine anderen Dateien.
 */

export interface RemoteFile { id: string; name: string; modifiedTime: string; size?: number }

export interface DriveLike {
  list(): Promise<RemoteFile[]>;
  upload(name: string, data: Uint8Array, mime?: string): Promise<RemoteFile>;
  /** Überschreibt den Inhalt einer bestehenden Datei */
  update(id: string, data: Uint8Array, mime?: string): Promise<void>;
  download(id: string): Promise<Uint8Array>;
  remove(id: string): Promise<void>;
}

export class AuthError extends Error {
  constructor() { super('Google-Anmeldung abgelaufen'); }
}

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export class GoogleDrive implements DriveLike {
  constructor(private token: () => Promise<string>) {}

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.token()}` } });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`Google Drive: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  async list(): Promise<RemoteFile[]> {
    const out: RemoteFile[] = [];
    let page: string | undefined;
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name,modifiedTime,size)', pageSize: '1000', orderBy: 'name' });
      if (page) q.set('pageToken', page);
      const j = await (await this.req(`${API}?${q}`)).json();
      out.push(...(j.files ?? []).map((f: RemoteFile & { size?: string }) => ({ ...f, size: f.size ? Number(f.size) : undefined })));
      page = j.nextPageToken;
    } while (page);
    return out;
  }

  private multipart(meta: object, data: Uint8Array, mime: string) {
    const boundary = `hb${Math.random().toString(36).slice(2)}`;
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + data.length + tail.length);
    body.set(head, 0); body.set(data, head.length); body.set(tail, head.length + data.length);
    return { body, type: `multipart/related; boundary=${boundary}` };
  }

  async upload(name: string, data: Uint8Array, mime = 'application/octet-stream'): Promise<RemoteFile> {
    const { body, type } = this.multipart({ name, parents: ['appDataFolder'] }, data, mime);
    const res = await this.req(`${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,size`, { method: 'POST', headers: { 'Content-Type': type }, body: body as BodyInit });
    return res.json();
  }

  async update(id: string, data: Uint8Array, mime = 'application/octet-stream'): Promise<void> {
    await this.req(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: data as BodyInit });
  }

  async download(id: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.req(`${API}/${id}?alt=media`)).arrayBuffer());
  }

  async remove(id: string): Promise<void> {
    await this.req(`${API}/${id}`, { method: 'DELETE' });
  }
}

/** Speicher-Drive für Tests (simuliert mehrere Geräte mit einem gemeinsamen Ordner) */
export class MemoryDrive implements DriveLike {
  files = new Map<string, { meta: RemoteFile; data: Uint8Array }>();
  private n = 0;
  private clock = Date.UTC(2030, 0, 1);
  private now() { this.clock += 1000; return new Date(this.clock).toISOString(); }
  async list() { return [...this.files.values()].map((f) => f.meta).sort((a, b) => a.name.localeCompare(b.name)); }
  async upload(name: string, data: Uint8Array) {
    const meta = { id: `f${++this.n}`, name, modifiedTime: this.now(), size: data.length };
    this.files.set(meta.id, { meta, data: data.slice() });
    return meta;
  }
  async update(id: string, data: Uint8Array) {
    const f = this.files.get(id);
    if (!f) throw new Error('nicht gefunden');
    this.files.set(id, { meta: { ...f.meta, modifiedTime: this.now(), size: data.length }, data: data.slice() });
  }
  async download(id: string) {
    const f = this.files.get(id);
    if (!f) throw new Error('nicht gefunden');
    return f.data.slice();
  }
  async remove(id: string) { this.files.delete(id); }
}
