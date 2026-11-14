/**
 * Minimaler, abhängigkeitsarmer xlsx-Leser für den Excel-Import.
 * Läuft komplett im Browser – die Datei verlässt das Gerät nicht.
 * Liest Zellwerte (inkl. zuletzt berechneter Formelwerte), Wahrheitswerte (Checkboxen),
 * gemeinsame Texte und verbundene Zellen. Formatierung wird ignoriert.
 */
import { unzipSync, strFromU8 } from 'fflate';

export type CellValue = string | number | boolean | null;

export interface Sheet {
  name: string;
  maxRow: number;
  /** Zelle per Zeile/Spalte (1-basiert) */
  get(row: number, col: number): CellValue;
  /** Bei verbundenen Zellen: Wert der linken oberen Zelle */
  getMerged(row: number, col: number): CellValue;
  /** Zeile der linken oberen Zelle, falls die Zelle zu einem Verbund über mehrere Zeilen gehört, sonst null */
  mergeAnchorRow(row: number, col: number): number | null;
}

export interface Workbook {
  sheetNames: string[];
  sheet(name: string): Sheet | undefined;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? _;
  });
}

/** Alle Textstücke <t>…</t> innerhalb eines Elements (auch Rich-Text) */
function texts(xml: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] ?? '';
  return decode(out);
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseRef(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return [0, 0];
  return [Number(m[2]), colIndex(m[1])];
}

function parseSheet(name: string, xml: string, shared: string[]): Sheet {
  const cells = new Map<number, CellValue>();
  const key = (r: number, c: number) => r * 1024 + c;
  let maxRow = 0;
  const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml))) {
    const attrs = m[1];
    const body = m[2] ?? '';
    const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
    if (!ref || !body) continue;
    const type = /\bt="(\w+)"/.exec(attrs)?.[1] ?? 'n';
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let val: CellValue = null;
    if (type === 's' && v !== undefined) val = shared[Number(v)] ?? null;
    else if (type === 'inlineStr') val = texts(body);
    else if (type === 'str') val = v !== undefined ? decode(v) : null;
    else if (type === 'b') val = v === '1';
    else if (type === 'e') val = null;
    else if (v !== undefined && v !== '') val = Number(v);
    if (val === null || val === '') continue;
    const [r, c] = parseRef(ref);
    cells.set(key(r, c), val);
    if (r > maxRow) maxRow = r;
  }
  // verbundene Zellen
  const mergeOf = new Map<number, number>();
  const anchorRow = new Map<number, number>();
  const mRe = /<mergeCell\s+ref="([A-Z]+\d+):([A-Z]+\d+)"/gi;
  while ((m = mRe.exec(xml))) {
    const [r1, c1] = parseRef(m[1]);
    const [r2, c2] = parseRef(m[2]);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      if (r !== r1 || c !== c1) mergeOf.set(key(r, c), key(r1, c1));
      if (r2 > r1) anchorRow.set(key(r, c), r1);
    }
  }
  return {
    name,
    maxRow,
    get: (r, c) => cells.get(key(r, c)) ?? null,
    getMerged: (r, c) => {
      const k = key(r, c);
      return cells.get(mergeOf.get(k) ?? k) ?? null;
    },
    mergeAnchorRow: (r, c) => anchorRow.get(key(r, c)) ?? null
  };
}

export function readWorkbook(data: ArrayBuffer | Uint8Array): Workbook {
  const files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : '');
  const wbXml = read('xl/workbook.xml');
  if (!wbXml) throw new Error('Keine gültige Excel-Datei (.xlsx)');
  const rels = read('xl/_rels/workbook.xml.rels');
  const relTarget = new Map<string, string>();
  for (const r of rels.matchAll(/<Relationship\s[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) relTarget.set(r[1], r[2]);
  for (const r of rels.matchAll(/<Relationship\s[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)) relTarget.set(r[2], r[1]);
  const shared: string[] = [];
  for (const si of read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(si[1]));

  const order: { name: string; path: string }[] = [];
  for (const s of wbXml.matchAll(/<sheet\s([^>]*?)\/?>/g)) {
    const name = decode(/\bname="([^"]*)"/.exec(s[1])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(s[1])?.[1] ?? '';
    let target = relTarget.get(rid) ?? '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    order.push({ name, path: target });
  }
  const cache = new Map<string, Sheet>();
  return {
    sheetNames: order.map((o) => o.name),
    sheet(name) {
      const hit = order.find((o) => o.name.toLowerCase() === name.toLowerCase());
      if (!hit) return undefined;
      if (!cache.has(hit.name)) cache.set(hit.name, parseSheet(hit.name, read(hit.path), shared));
      return cache.get(hit.name);
    }
  };
}

/** Excel-Seriennummer → ISO-Datum (1900-System) */
export function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}
