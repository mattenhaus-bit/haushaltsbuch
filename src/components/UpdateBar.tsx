import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/** Zeigt „Neue Version verfügbar“, sobald ein Update geladen ist. Aktualisiert erst nach Tipp. */
export function UpdateBar() {
  const [update, setUpdate] = useState<null | ((reload?: boolean) => Promise<void>)>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (import.meta.env.VITE_PREVIEW || !('serviceWorker' in navigator)) return;
    const updateSW = registerSW({
      onNeedRefresh: () => setUpdate(() => updateSW),
      onRegisteredSW: (_url, reg) => {
        // Beim Zurückkehren in die App nach Updates schauen
        if (reg) document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update());
      }
    });
  }, []);
  if (!update || hidden) return null;
  return (
    <div className="updatebar" role="status">
      Neue Version verfügbar
      <button className="later" onClick={() => setHidden(true)}>Später</button>
      <button onClick={() => update(true)}>Aktualisieren</button>
    </div>
  );
}
