import { useEffect, useState, FormEvent } from 'react';
import {
  insightStats, insightLawyers, insightLawyer, adminLogin, logout, getStoredEmail, HttpError,
  InsightLawyer, InsightProfile,
} from './api';
import { jurisCourt } from './juridictions';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
type Phase = 'loading' | 'login' | 'denied' | 'ready';

export default function InsightApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [stats, setStats] = useState<{ lawyers: number; appearances: number } | null>(null);

  const load = async () => {
    try {
      setStats(await insightStats());
      setPhase('ready');
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) setPhase('login');
      else setPhase('denied');
    }
  };
  useEffect(() => { load(); }, []);

  if (phase === 'loading') return <div className="route-loading">Chargement…</div>;
  if (phase === 'login') return <InsightLogin onDone={load} />;
  if (phase === 'denied') return <Denied />;
  return <InsightMain stats={stats} onLogout={async () => { await logout(); setPhase('login'); }} />;
}

function Denied() {
  return (
    <div className="admin-gate">
      <h1>Insight</h1>
      <p className="muted">Module réservé aux administrateurs.</p>
      <a className="send" href="/">Retour à l'application</a>
    </div>
  );
}

function InsightLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(getStoredEmail() || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await adminLogin(email.trim(), password); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
    finally { setBusy(false); }
  };
  return (
    <div className="admin-gate">
      <h1>⚖️ Insight</h1>
      <p className="muted">Connexion administrateur.</p>
      <form onSubmit={submit} className="auth-form">
        <label>Email<input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Mot de passe<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="warn">⚠ {error}</p>}
        <button className="send" disabled={busy}>{busy ? '…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}

function InsightMain({ stats, onLogout }: {
  stats: { lawyers: number; appearances: number } | null; onLogout: () => void;
}) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<InsightLawyer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<InsightProfile | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      insightLawyers(q, 100).then(setList).finally(() => setLoading(false));
    }, q ? 280 : 0);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="insight">
      <header className="admin-header">
        <strong className="admin-brand">⚖️ Insight <span className="muted">— avocats</span></strong>
        <div className="admin-tabs" />
        <a className="ghost" href="/">← Application</a>
        <button className="ghost" onClick={onLogout}>Déconnexion</button>
      </header>
      <main className="admin-main">
        <div className="insight-note">
          <b>Profilage limité aux avocats</b>, à partir des décisions <b>publiques</b> de jurisprudence.
          Usage interne (base légale : intérêt légitime — aucune rediffusion). Volontairement <b>pas</b> de
          magistrats ni de greffiers.
        </div>
        {stats && (
          <p className="muted insight-stats">
            <b>{stats.lawyers.toLocaleString('fr-FR')}</b> avocats indexés ·
            {' '}<b>{stats.appearances.toLocaleString('fr-FR')}</b> apparitions
          </p>
        )}

        {sel ? (
          <Profile p={sel} onBack={() => setSel(null)} />
        ) : (
          <>
            <input className="insight-search" placeholder="Rechercher un avocat…" value={q}
              onChange={(e) => setQ(e.target.value)} autoFocus />
            {loading && !list ? <p className="muted">Chargement…</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Avocat</th><th className="num">Décisions</th><th>Période</th></tr></thead>
                  <tbody>
                    {(list || []).map((l) => (
                      <tr key={l.name_key} className="insight-row"
                        onClick={() => insightLawyer(l.name_key).then(setSel)}>
                        <td><b>{l.name}</b></td>
                        <td className="num">{l.cases}</td>
                        <td className="muted">{yearsSpan(l.first_year, l.last_year)}</td>
                      </tr>
                    ))}
                    {list && list.length === 0 && (
                      <tr><td colSpan={3} className="muted">Aucun avocat{q ? ` pour « ${q} »` : ''}.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
      <footer className="insight-foot muted">Insight — maquette interne <span className="version">{APP_VERSION}</span></footer>
    </div>
  );
}

function Profile({ p, onBack }: { p: InsightProfile; onBack: () => void }) {
  // Répartition par juridiction dérivée du doc_id (plus fiable que la clé, souvent nulle).
  const counts: Record<string, number> = {};
  for (const c of p.cases) {
    const label = jurisCourt(c.doc_id, c.juridiction_key);
    counts[label] = (counts[label] || 0) + 1;
  }
  const courts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="insight-profile">
      <button className="back linklike" onClick={onBack}>← Tous les avocats</button>
      <h2>{p.name}</h2>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-label">décisions</div><div className="stat-value">{p.cases_count}</div></div>
        <div className="stat-tile"><div className="stat-label">période</div><div className="stat-value">{yearsSpan(p.first_year, p.last_year)}</div></div>
        <div className="stat-tile"><div className="stat-label">juridictions</div><div className="stat-value">{courts.length}</div></div>
      </div>

      <h3>Répartition par juridiction</h3>
      <div className="insight-chips">
        {courts.map(([label, n]) => <span key={label} className="chip">{label} · {n}</span>)}
      </div>

      <h3>Décisions ({p.cases_count})</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Décision</th><th>Année</th><th>Juridiction</th><th></th></tr></thead>
          <tbody>
            {p.cases.map((c) => (
              <tr key={c.doc_id}>
                <td className="mono-cell">{c.doc_id}</td>
                <td>{c.year ?? '—'}</td>
                <td className="muted">{jurisCourt(c.doc_id, c.juridiction_key)}</td>
                <td><a href={`/docs/${c.doc_id}.pdf`} target="_blank" rel="noopener noreferrer">PDF ↗</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function yearsSpan(a: number | null, b: number | null): string {
  if (!a && !b) return '—';
  if (a && b && a !== b) return `${a}–${b}`;
  return String(a || b);
}
