// Palette de commande ⌘K — recherche FÉDÉRÉE (LOT 2 ergonomie). Un seul champ cherche :
//  • une QUESTION juridique (lance la recherche RAG),
//  • un AVOCAT (préfixe « a: »)  → ouvre son profil Insight,
//  • un CABINET (préfixe « c: ») → ouvre sa fiche Insight.
// Aucun nouveau backend : composition des endpoints Insight existants. Clavier : ↑/↓, Entrée, Échap.
import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { insightLawyers, insightFirms } from './api';

type Result =
  | { kind: 'ask'; label: string; q: string }
  | { kind: 'lawyer'; label: string; sub: string; key: string }
  | { kind: 'firm'; label: string; sub: string; firm: string };

export function CmdK({ onClose, onAsk }: { onClose: () => void; onAsk: (q: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const raw = q.trim();
    const mA = raw.match(/^a:\s*(.*)$/i);
    const mC = raw.match(/^c:\s*(.*)$/i);
    const scope: 'all' | 'lawyer' | 'firm' = mA ? 'lawyer' : mC ? 'firm' : 'all';
    const term = (mA?.[1] ?? mC?.[1] ?? raw).trim();
    // Proposer TOUJOURS de lancer une recherche juridique quand aucun préfixe n'est utilisé.
    const base: Result[] = raw && scope === 'all'
      ? [{ kind: 'ask', label: `Rechercher : « ${raw} »`, q: raw }]
      : [];
    if (term.length < 2) { setResults(base); setSel(0); setLoading(false); return; }
    const id = ++reqId.current;
    setLoading(true);
    const jobs: Promise<Result[]>[] = [];
    if (scope !== 'firm')
      jobs.push(insightLawyers(term, 5).then((ls): Result[] => ls.map((l) => ({
        kind: 'lawyer', label: l.name, key: l.name_key,
        sub: `${l.cases} décision${l.cases > 1 ? 's' : ''}`,
      }))).catch(() => []));
    if (scope !== 'lawyer')
      jobs.push(insightFirms(term, 5).then((fs): Result[] => fs.map((f) => ({
        kind: 'firm', label: f.firm, firm: f.firm,
        sub: `${f.lawyers} avocat·e·s · ${f.cases} décisions`,
      }))).catch(() => []));
    Promise.all(jobs).then((groups) => {
      if (id !== reqId.current) return;   // réponse périmée : une frappe plus récente a pris la main
      setResults([...base, ...groups.flat()]);
      setSel(0); setLoading(false);
    });
  }, [q]);

  const activate = (r: Result) => {
    if (r.kind === 'ask') { onAsk(r.q); onClose(); }
    else if (r.kind === 'lawyer') window.location.href = `/insight?a=${encodeURIComponent(r.key)}`;
    else window.location.href = `/insight?f=${encodeURIComponent(r.firm)}`;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[sel]) activate(results[sel]);
      else if (q.trim()) { onAsk(q.trim()); onClose(); }
    } else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Recherche rapide">
        <div className="cmdk-inputrow">
          <span className="cmdk-ico" aria-hidden="true">🔍</span>
          <input ref={inputRef} className="cmdk-input" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey} placeholder="Rechercher une question, un avocat (a:), un cabinet (c:)…"
            aria-label="Recherche rapide" />
          <kbd className="cmdk-kbd">Échap</kbd>
        </div>
        <div className="cmdk-results">
          {results.length === 0 ? (
            <p className="cmdk-empty">
              {loading ? 'Recherche…'
                : q.trim() ? 'Aucun résultat — Entrée pour lancer une recherche juridique.'
                : 'Questions juridiques, avocats, cabinets… Préfixes : a: avocat · c: cabinet.'}
            </p>
          ) : results.map((r, i) => (
            <button key={i} className={`cmdk-item${i === sel ? ' on' : ''}`}
              onMouseEnter={() => setSel(i)} onClick={() => activate(r)}>
              <span className="cmdk-item-ico" aria-hidden="true">{r.kind === 'ask' ? '🔍' : r.kind === 'lawyer' ? '⚖️' : '🏛️'}</span>
              <span className="cmdk-item-txt">
                <span className="cmdk-item-label">{r.label}</span>
                {r.kind !== 'ask' && <span className="cmdk-item-sub">{r.sub}</span>}
              </span>
              <span className="cmdk-item-kind">{r.kind === 'ask' ? 'Recherche' : r.kind === 'lawyer' ? 'Avocat' : 'Cabinet'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
