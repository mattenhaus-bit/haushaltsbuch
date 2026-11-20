import { useMemo, useState, type ReactNode } from 'react';
import type { AppData } from '../data';
import { catPath, suggestCategories, type HistoryItem } from '../lib/suggest';

/** Vorschlagsliste unter einem Eingabefeld (Tippen übernimmt, Fokus bleibt im Feld) */
export function SuggestList<T>({ items, render, onPick, label }: {
  items: T[]; render: (x: T) => ReactNode; onPick: (x: T) => void; label: string;
}) {
  if (!items.length) return null;
  return (
    <div className="suggest" role="listbox" aria-label={label}>
      {items.map((x, i) => (
        <button type="button" role="option" aria-selected={false} key={i} className="sugg"
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(x)}>
          {render(x)}
        </button>
      ))}
    </div>
  );
}

/**
 * Kategorieauswahl:
 * - Suchfeld mit Vorschlägen (Name, Stichwort wie „Kirche“ → Spende, eigene frühere Buchungen)
 * - häufig genutzte Kategorien inkl. Unterkategorien als Schnellauswahl
 * - „Alle Kategorien“ als übersichtlicher Baum (Hauptkategorie mit ihren Unterkategorien)
 */
export function CategoryPicker({ d, group, value, onChange, top, history }: {
  d: AppData; group: 'expense' | 'income' | 'bill'; value?: string; onChange: (id: string) => void; top?: string[]; history?: HistoryItem[];
}) {
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(!top);
  const mains = d.categories.filter((c) => c.group === group && !c.parentId && !c.archived && !c.deleted);
  const cur = value ? d.catById.get(value) : undefined;
  const hits = useMemo(() => suggestCategories(q, d, group, history, 6), [q, d, group, history]);
  const icon = (id: string) => {
    const c = d.catById.get(id);
    return c?.icon ?? d.catById.get(c?.parentId ?? '')?.icon ?? '';
  };
  const pick = (id: string) => { onChange(id); setQ(''); };
  const chip = (id: string) => (
    <button type="button" key={id} className={`chip ${id === value ? 'on' : ''}`} onClick={() => pick(id)}>
      {icon(id)} {catPath(d.catById.get(id), d.catById)}
    </button>
  );
  const quick = (top ?? []).filter((id) => d.catById.get(id) && !d.catById.get(id)!.archived);

  return (
    <div className="catpicker">
      {cur && (
        <div className="catsel">
          <span className="ic">{icon(cur.id)}</span>
          <span className="grow">{catPath(cur, d.catById)}</span>
        </div>
      )}
      <input className="input" type="search" enterKeyHint="done" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Kategorie suchen – z. B. Spende, Tanken, Pizza" aria-label="Kategorie suchen" autoComplete="off" />
      {q ? (
        hits.length ? (
          <SuggestList label="Passende Kategorien" items={hits} onPick={(h) => pick(h.id)} render={(h) => (
            <>
              <span className="ic">{icon(h.id)}</span>
              <span className="grow">{catPath(d.catById.get(h.id), d.catById)}</span>
              {h.reason && <span className="small muted">„{h.reason}“</span>}
            </>
          )} />
        ) : <div className="small muted" style={{ padding: '8px 2px' }}>Nichts gefunden – wähle unten unter „Alle Kategorien“.</div>
      ) : quick.length > 0 && !showAll && !value && (
        <div className="chips" style={{ marginTop: 8 }}>{quick.map(chip)}</div>
      )}
      {top && (
        <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Nur häufige zeigen' : 'Alle Kategorien'}
        </button>
      )}
      {showAll && (
        <div className="cattree">
          {mains.map((m) => {
            const subs = d.categories.filter((c) => c.parentId === m.id && !c.archived && !c.deleted);
            return (
              <div className="cgroup" key={m.id}>
                <button type="button" className={`chip main ${value === m.id ? 'on' : ''}`} onClick={() => pick(m.id)}>
                  {m.icon} {m.name}
                </button>
                {subs.map((s) => (
                  <button type="button" key={s.id} className={`chip sub ${value === s.id ? 'on' : ''}`} onClick={() => pick(s.id)}>{s.name}</button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
