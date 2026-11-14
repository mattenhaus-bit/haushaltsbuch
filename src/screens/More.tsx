import { useState } from 'react';
import type { Account, Category, CategoryGroup, MerchantRule, Pot } from '../db/schema';
import { db } from '../db/schema';
import { stamp } from '../db/meta';
import * as A from '../db/actions';
import { potStatus } from '../lib/calc';
import { currentMonth, today } from '../lib/dates';
import { centsToInput, euroShort, parseEuro } from '../lib/money';
import { catLabel, type AppData } from '../data';
import { CategoryPicker, Field, Money, pressable, Sheet } from '../components/ui';

const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const GROUPS: [CategoryGroup, string][] = [['expense', 'Ausgaben'], ['income', 'Einnahmen'], ['bill', 'Fixkosten-Bereiche']];

export function More({ d, toast }: { d: AppData; toast: (m: string) => void }) {
  const [pot, setPot] = useState<Pot | 'new' | null>(null);
  const [acc, setAcc] = useState<Account | null>(null);
  const [cat, setCat] = useState<Partial<Category> | null>(null);
  const [merch, setMerch] = useState<MerchantRule | 'new' | null>(null);
  const [catGroup, setCatGroup] = useState<CategoryGroup>('expense');

  const theme = (d.settings.theme as string) ?? 'system';
  const shift = (d.settings.incomeShiftDay as number) ?? 25;

  const download = async () => {
    const json = await A.exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `haushaltsbuch-sicherung-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    await A.setSetting('lastBackup', new Date().toISOString());
  };
  const [pending, setPending] = useState<{ name: string; text: string } | null>(null);
  const addFile = async (f: File) => {
    try {
      const counts = await A.mergeImport(await f.text());
      const labels: Record<string, string> = { recurring: 'Fixkosten', pots: 'Töpfe', categories: 'Kategorien', merchants: 'Läden', accounts: 'Konten', transactions: 'Buchungen', budgets: 'Pläne' };
      toast(`Übernommen: ${Object.entries(counts).map(([k, v]) => `${v} ${labels[k] ?? k}`).join(', ') || 'nichts'}`);
    } catch (e) { toast((e as Error).message); }
  };
  const restore = async (f: File) => setPending({ name: f.name, text: await f.text() });
  const doRestore = async () => {
    if (!pending) return;
    try { await A.importBackup(pending.text); toast('Sicherung wiederhergestellt'); } catch (e) { toast((e as Error).message); }
    setPending(null);
  };

  const mains = d.categories.filter((c) => c.group === catGroup && !c.parentId);
  const lastBackup = d.settings.lastBackup as string | undefined;

  return (
    <>
      <div className="pagehead"><div><h1>Mehr</h1><div className="sub">Töpfe, Kategorien, Einstellungen</div></div></div>
      <div className="cols c2">
        <div className="stack">
          <div className="card">
            <h2>Rücklagen-Töpfe <button className="btn sm primary" onClick={() => setPot('new')}>+ Neu</button></h2>
            {d.pots.map((p) => {
              const st = potStatus(p, d.txs);
              const rate = p.monthlyRate ?? Math.round(p.yearlyAmount / 12);
              return (
                <div className="row click" key={p.id} {...pressable(() => setPot(p))} style={{ opacity: p.archived ? 0.5 : 1 }}>
                  <span className="cico sm" style={{ background: 'var(--surface-2)' }}>🫙</span>
                  <div className="grow">
                    <div className="title">{p.name}</div>
                    <div className="sub">{euroShort(rate)}/Monat · {euroShort(p.yearlyAmount)}/Jahr · fällig {p.dueMonths.map((m) => MONTH_SHORT[m - 1]).join(', ')}</div>
                  </div>
                  <Money c={st.balance} />
                </div>
              );
            })}
            <p className="small muted" style={{ margin: '8px 0 0' }}>Töpfe liegen auf dem Tagesgeld, zusätzlich zum Notgroschen. Die Monatsrate erscheint automatisch bei den Fixkosten.</p>
          </div>
          <div className="card">
            <h2>Konten</h2>
            {d.accounts.map((a) => (
              <div className="row click" key={a.id} {...pressable(() => setAcc(a))}>
                <span className="cico sm" style={{ background: 'var(--surface-2)' }}>{a.kind === 'giro' ? '🏦' : a.kind === 'tagesgeld' ? '💶' : a.kind === 'depot' ? '📈' : '👛'}</span>
                <div className="grow"><div className="title">{a.name}</div><div className="sub">{a.isBudget ? 'Haushaltskonto' : a.floor ? `Notgroschen ${euroShort(a.floor)}` : ''}</div></div>
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Läden <button className="btn sm primary" onClick={() => setMerch('new')}>+ Neu</button></h2>
            <p className="small muted" style={{ marginTop: 0 }}>Enthält ein Text das Stichwort, wird die Kategorie automatisch gesetzt.</p>
            {d.merchants.map((m) => (
              <div className="row click" key={m.id} {...pressable(() => setMerch(m))}>
                <div className="grow"><div className="title">{m.label} {m.quick ? '⭐' : ''}</div><div className="sub">„{m.pattern}“ → {catLabel(d, m.categoryId)}</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Kategorien <button className="btn sm primary" onClick={() => setCat({ group: catGroup })}>+ Neu</button></h2>
            <div className="seg" style={{ marginBottom: 8 }}>
              {GROUPS.map(([g, l]) => <button key={g} className={catGroup === g ? 'on' : ''} onClick={() => setCatGroup(g)}>{l}</button>)}
            </div>
            {mains.map((c) => (
              <div key={c.id}>
                <div className="row click" {...pressable(() => setCat(c))} style={{ opacity: c.archived ? 0.45 : 1 }}>
                  <span className="cico sm" style={{ background: 'var(--surface-2)' }}>{c.icon ?? '•'}</span>
                  <span className="grow title">{c.name}{c.archived ? ' (archiviert)' : ''}</span>
                  {catGroup === 'expense' && <button className="btn sm" onClick={(e) => { e.stopPropagation(); setCat({ group: c.group, parentId: c.id }); }}>+ Unter</button>}
                </div>
                {d.categories.filter((s) => s.parentId === c.id).map((s) => (
                  <div className="row click" key={s.id} {...pressable(() => setCat(s))} style={{ paddingLeft: 44, opacity: s.archived ? 0.45 : 1 }}>
                    <span className="grow small">{s.name}{s.archived ? ' (archiviert)' : ''}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Einstellungen</h2>
            <Field label="Darstellung">
              <div className="seg">
                {[['system', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => (
                  <button key={v} className={theme === v ? 'on' : ''} onClick={() => A.setSetting('theme', v)}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label="Einnahmen ab diesem Tag zählen für den Folgemonat">
              <select className="input" value={shift} onChange={(e) => A.setSetting('incomeShiftDay', Number(e.target.value))}>
                <option value={0}>nie (immer Eingangsmonat)</option>
                {[20, 22, 24, 25, 26, 27, 28].map((n) => <option key={n} value={n}>ab dem {n}.</option>)}
              </select>
            </Field>
          </div>
          <div className="card">
            <h2>Datensicherung</h2>
            <p className="small muted" style={{ marginTop: 0 }}>
              Deine Daten liegen bisher <strong>nur auf diesem Gerät</strong>. Die verschlüsselte Google-Drive-Synchronisation folgt im nächsten Schritt. Bis dahin bitte regelmäßig sichern.
              {lastBackup && <><br />Letzte Sicherung: {new Date(lastBackup).toLocaleString('de-DE')}</>}
            </p>
            <div className="flex">
              <button className="btn primary grow" onClick={download}>Sicherung herunterladen</button>
              <label className="btn grow" style={{ textAlign: 'center' }}>
                Wiederherstellen
                <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
              </label>
            </div>
            <label className="btn block" style={{ textAlign: 'center', marginTop: 10 }}>
              Startdaten hinzufügen (private Datei)
              <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && addFile(e.target.files[0])} />
            </label>
            <p className="small muted" style={{ margin: '6px 0 0' }}>Fügt z. B. deine Fixkosten und Töpfe aus <code>privat/startdaten.json</code> hinzu, ohne vorhandene Daten zu löschen.</p>
            {pending && (
              <div className="note" style={{ marginTop: 10 }}>
                „{pending.name}“ ersetzt <strong>alle aktuellen Daten</strong>. Tipp: vorher selbst eine Sicherung herunterladen.
                <div className="flex" style={{ marginTop: 8 }}>
                  <button className="btn danger" onClick={doRestore}>Ersetzen</button>
                  <button className="btn" onClick={() => setPending(null)}>Abbrechen</button>
                </div>
              </div>
            )}
          </div>
          <p className="small muted" style={{ textAlign: 'center' }}>Haushaltsbuch · Version 0.1 (MVP)</p>
        </div>
      </div>

      {pot && <PotSheet d={d} pot={pot === 'new' ? undefined : pot} onClose={() => setPot(null)} />}
      {acc && <AccountSheet acc={acc} onClose={() => setAcc(null)} />}
      {cat && <CategorySheet d={d} cat={cat} onClose={() => setCat(null)} />}
      {merch && <MerchantSheet d={d} m={merch === 'new' ? undefined : merch} onClose={() => setMerch(null)} />}
    </>
  );
}

function PotSheet({ d, pot, onClose }: { d: AppData; pot?: Pot; onClose: () => void }) {
  const [name, setName] = useState(pot?.name ?? '');
  const [yearly, setYearly] = useState(pot ? centsToInput(pot.yearlyAmount) : '');
  const [rate, setRate] = useState(pot?.monthlyRate !== undefined ? centsToInput(pot.monthlyRate) : '');
  const [opening, setOpening] = useState(pot ? centsToInput(pot.openingBalance) : '0');
  const [due, setDue] = useState<number[]>(pot?.dueMonths ?? []);
  const y = parseEuro(yearly), r = rate ? parseEuro(rate) : undefined, o = parseEuro(opening) ?? 0;
  const tg = d.accounts.find((a) => a.kind === 'tagesgeld') ?? d.accounts[0];
  const save = async (archived?: 0 | 1) => {
    if (!name.trim() || y === null) return;
    await A.savePot({ id: pot?.id, name: name.trim(), yearlyAmount: y, monthlyRate: r ?? undefined, openingBalance: o, dueMonths: due, accountId: pot?.accountId ?? tg.id, start: pot?.start ?? currentMonth(), archived: archived ?? pot?.archived });
    await A.ensureMonth(currentMonth());
    onClose();
  };
  return (
    <Sheet title={pot ? `Topf ${pot.name}` : 'Neuer Topf'} onClose={onClose}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Auto-Reparatur" /></Field>
      <div className="flex">
        <div className="grow"><Field label="Jahresbedarf"><input className="input num" inputMode="decimal" value={yearly} onChange={(e) => setYearly(e.target.value)} /></Field></div>
        <div className="grow"><Field label="Monatsrate (leer = ÷12)"><input className="input num" inputMode="decimal" value={rate} placeholder={y ? centsToInput(Math.round(y / 12)) : ''} onChange={(e) => setRate(e.target.value)} /></Field></div>
      </div>
      <Field label="Aktueller Bestand im Topf"><input className="input num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
      <Field label="Typische Fälligkeit">
        <div className="chips">{MONTH_SHORT.map((m, i) => <button type="button" key={m} className={`chip ${due.includes(i + 1) ? 'on' : ''}`} onClick={() => setDue(due.includes(i + 1) ? due.filter((x) => x !== i + 1) : [...due, i + 1].sort((a, b) => a - b))}>{m}</button>)}</div>
      </Field>
      <button className="btn primary block" onClick={() => save()} disabled={!name.trim() || y === null}>Speichern</button>
      {pot && <button className="btn block" style={{ marginTop: 8 }} onClick={() => save(pot.archived ? 0 : 1)}>{pot.archived ? 'Wieder aktivieren' : 'Archivieren (keine Raten mehr)'}</button>}
    </Sheet>
  );
}

function AccountSheet({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const [name, setName] = useState(acc.name);
  const [floor, setFloor] = useState(acc.floor !== undefined ? centsToInput(acc.floor) : '');
  const save = async () => {
    await db.accounts.put(await stamp({ ...acc, name: name.trim() || acc.name, floor: floor ? parseEuro(floor) ?? undefined : undefined }));
    onClose();
  };
  return (
    <Sheet title="Konto" onClose={onClose}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {acc.kind === 'tagesgeld' && <Field label="Notgroschen (Mindestbestand)"><input className="input num" inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} /></Field>}
      <button className="btn primary block" onClick={save}>Speichern</button>
    </Sheet>
  );
}

function CategorySheet({ d, cat, onClose }: { d: AppData; cat: Partial<Category>; onClose: () => void }) {
  const [name, setName] = useState(cat.name ?? '');
  const [icon, setIcon] = useState(cat.icon ?? '');
  const [mergeTo, setMergeTo] = useState('');
  const group = cat.group ?? 'expense';
  const parent = cat.parentId ? d.catById.get(cat.parentId) : undefined;
  const save = async (archived?: 0 | 1) => {
    if (!name.trim()) return;
    await A.saveCategory({ ...cat, group, name: name.trim(), icon: icon || undefined, archived: archived ?? cat.archived });
    onClose();
  };
  const used = cat.id ? d.txs.filter((t) => t.categoryId === cat.id).length : 0;
  return (
    <Sheet title={cat.id ? 'Kategorie bearbeiten' : parent ? `Neue Unterkategorie von ${parent.name}` : 'Neue Kategorie'} onClose={onClose}>
      <div className="flex">
        {!cat.parentId && <div style={{ width: 80 }}><Field label="Symbol"><input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🙂" /></Field></div>}
        <div className="grow"><Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
      </div>
      <button className="btn primary block" onClick={() => save()} disabled={!name.trim()}>Speichern</button>
      {cat.id && (
        <>
          <button className="btn block" style={{ marginTop: 8 }} onClick={() => save(cat.archived ? 0 : 1)}>{cat.archived ? 'Wieder aktivieren' : 'Archivieren (ausblenden, Daten bleiben)'}</button>
          <div className="card" style={{ marginTop: 14 }}>
            <Field label={`Zusammenführen in … (${used} Buchungen werden umgehängt)`}>
              <CategoryPicker d={d} group={group} value={mergeTo} onChange={setMergeTo} />
            </Field>
            <button className="btn block" disabled={!mergeTo || mergeTo === cat.id} onClick={async () => { await A.mergeCategory(cat.id!, mergeTo); onClose(); }}>Zusammenführen</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function MerchantSheet({ d, m, onClose }: { d: AppData; m?: MerchantRule; onClose: () => void }) {
  const [label, setLabel] = useState(m?.label ?? '');
  const [pattern, setPattern] = useState(m?.pattern ?? '');
  const [cat, setCat] = useState(m?.categoryId ?? 'exp-sonstiges');
  const [quick, setQuick] = useState(m ? !!m.quick : true);
  const save = async () => {
    if (!label.trim()) return;
    await A.saveMerchant({ id: m?.id, label: label.trim(), pattern: (pattern || label).trim(), categoryId: cat, quick: quick ? 1 : 0 });
    onClose();
  };
  return (
    <Sheet title={m ? 'Laden bearbeiten' : 'Neuer Laden'} onClose={onClose}>
      <Field label="Name (Schnellwahl)"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Kaufland" /></Field>
      <Field label="Stichwort im Text (optional)"><input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={label.toLowerCase()} /></Field>
      <Field label="Kategorie"><CategoryPicker d={d} group="expense" value={cat} onChange={setCat} /></Field>
      <label className="flex" style={{ marginBottom: 12 }}><input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> Als Schnellwahl beim Einkauf anzeigen</label>
      <button className="btn primary block" onClick={save} disabled={!label.trim()}>Speichern</button>
      {m && <button className="btn danger block" style={{ marginTop: 8 }} onClick={async () => { await db.merchants.put(await stamp({ ...m, deleted: 1 as const })); onClose(); }}>Löschen</button>}
    </Sheet>
  );
}
