const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const IcHome = () => (<svg className="ico" viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8" /><path d="M12 4v8l5.5 5.5" /></svg>);
export const IcList = () => (<svg className="ico" viewBox="0 0 24 24" {...P}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>);
export const IcBills = () => (<svg className="ico" viewBox="0 0 24 24" {...P}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 9l2 2 4-4M8 16h8" /></svg>);
export const IcYear = () => (<svg className="ico" viewBox="0 0 24 24" {...P}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>);
export const IcMore = () => (<svg className="ico" viewBox="0 0 24 24" {...P}><circle cx="12" cy="8" r="3" /><path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5" /></svg>);
export const IcPlus = () => (<svg viewBox="0 0 24 24" {...P} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>);
