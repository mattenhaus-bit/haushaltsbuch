import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { addMonths, monthLabel, type Month } from '../lib/dates';
import { euro, type Cents } from '../lib/money';

/** Macht ein Element (z. B. eine Listenzeile) per Maus, Touch UND Tastatur bedienbar */
export function pressable(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
    }
  };
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Modaler Dialog: Escape schließt, Fokus bleibt im Dialog und kehrt danach zum Auslöser zurück */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Erstes Feld fokussieren, sofern nicht schon ein Feld (autoFocus) aktiv ist
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>('input, select, textarea') ?? el).focus({ preventScroll: true });
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', h);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // Hintergrund nicht scrollen
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="grab" />
        <div className="head">
          <h3>{title}</h3>
          <button className="xbtn" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function MonthSwitcher({ month, onChange }: { month: Month; onChange: (m: Month) => void }) {
  return (
    <div className="monthsw">
      <button onClick={() => onChange(addMonths(month, -1))} aria-label="Vorheriger Monat">‹</button>
      <span>{monthLabel(month)}</span>
      <button onClick={() => onChange(addMonths(month, 1))} aria-label="Nächster Monat">›</button>
    </div>
  );
}

export function Money({ c, sign = false, className = '' }: { c: Cents; sign?: boolean; className?: string }) {
  const cls = sign && c > 0 ? 'pos' : ''; // Ausgaben neutral, Eingänge grün
  return <span className={`num ${cls} ${className}`}>{sign && c > 0 ? '+' : ''}{euro(c)}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  // Beschriftung mit dem Eingabefeld verknüpfen (Screenreader, Antippen der Beschriftung)
  const autoId = useId();
  const single = isValidElement<{ id?: string }>(children) ? children : null;
  const id = single ? (single.props.id ?? autoId) : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {single ? cloneElement(single, { id }) : children}
    </div>
  );
}

/** Kategorie-Auswahl: Hauptkategorien als Chips, danach optional Unterkategorie */
export { CategoryPicker } from './pickers';

export function Toast({ text, action, onAction, onDone }: { text: string; action?: string; onAction?: () => void; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="toast" role="status">
      {text}
      {action && <button onClick={() => { onAction?.(); onDone(); }}>{action}</button>}
    </div>
  );
}

/** Löschen o. Ä. mit zweitem Tipp bestätigen (statt Browser-Dialog) */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn danger block', style }: {
  label: string; confirmLabel: string; onConfirm: () => void; className?: string; style?: React.CSSProperties;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={className} style={style} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmLabel : label}
    </button>
  );
}
