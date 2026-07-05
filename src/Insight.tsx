import { useEffect, useState, FormEvent } from 'react';
import {
  insightStats, insightLawyers, insightLawyer, adminLogin, logout, getStoredEmail, HttpError,
  InsightLawyer, InsightProfile, InsightCase,
} from './api';
import { jurisCourt, jurisDate, jurisRef } from './juridictions';

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

  const maxCases = list && list.length ? Math.max(...list.map((l) => l.cases)) : 1;

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

        {sel ? (
          <Profile p={sel} onBack={() => setSel(null)} />
        ) : (
          <>
            {stats && (
              <p className="muted insight-stats">
                <b>{stats.lawyers.toLocaleString('fr-FR')}</b> avocats indexés ·
                {' '}<b>{stats.appearances.toLocaleString('fr-FR')}</b> apparitions
              </p>
            )}
            <input className="insight-search" placeholder="Rechercher un avocat…" value={q}
              onChange={(e) => setQ(e.target.value)} autoFocus />
            {list && (
              <p className="insight-count muted">
                {list.length}{list.length === 100 ? '+' : ''} résultat{list.length > 1 ? 's' : ''}
                {' '}· classés par nombre de décisions
              </p>
            )}
            {loading && !list ? <p className="muted">Chargement…</p> : (
              <ol className="insight-list">
                {(list || []).map((l, i) => (
                  <li key={l.name_key}>
                    <button className="lw-row" onClick={() => insightLawyer(l.name_key).then(setSel)}>
                      <span className="rank">{q ? '·' : `#${i + 1}`}</span>
                      <span className="lw-name">{l.name}</span>
                      <span className="lw-bar" aria-hidden="true">
                        <span className="lw-bar-fill" style={{ width: `${Math.max(4, Math.round((l.cases / maxCases) * 100))}%` }} />
                      </span>
                      <span className="lw-count">{l.cases}</span>
                      <span className="lw-period muted">{yearsSpan(l.first_year, l.last_year)}</span>
                    </button>
                  </li>
                ))}
                {list && list.length === 0 && (
                  <li className="muted insight-empty">Aucun avocat{q ? ` pour « ${q} »` : ''}.</li>
                )}
              </ol>
            )}
          </>
        )}
      </main>
      <footer className="insight-foot">Insight — maquette interne <span className="version">{APP_VERSION}</span></footer>
    </div>
  );
}

function Profile({ p, onBack }: { p: InsightProfile; onBack: () => void }) {
  // Répartitions dérivées des doc_id (plus fiables que la clé juridiction, souvent nulle).
  const jc: Record<string, number> = {};
  const yc: Record<number, number> = {};
  for (const c of p.cases) {
    const court = jurisCourt(c.doc_id, c.juridiction_key);
    jc[court] = (jc[court] || 0) + 1;
    if (c.year) yc[c.year] = (yc[c.year] || 0) + 1;
  }
  const courts = Object.entries(jc).sort((a, b) => b[1] - a[1]);
  const yrs = Object.keys(yc).map(Number).sort((a, b) => a - b);
  const yMax = Math.max(1, ...Object.values(yc));
  const allYears = yrs.length ? Array.from({ length: yrs[yrs.length - 1] - yrs[0] + 1 }, (_, i) => yrs[0] + i) : [];

  return (
    <div className="insight-profile">
      <button className="back linklike" onClick={onBack}>← Tous les avocats</button>
      <h2>{p.name}</h2>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-label">décisions</div><div className="stat-value">{p.cases_count}</div></div>
        <div className="stat-tile"><div className="stat-label">période</div><div className="stat-value">{yearsSpan(p.first_year, p.last_year)}</div></div>
        <div className="stat-tile"><div className="stat-label">juridictions</div><div className="stat-value">{courts.length}</div></div>
      </div>

      {allYears.length > 1 && (
        <>
          <h3>Activité par année</h3>
          <div className="year-chart">
            {allYears.map((y) => (
              <div key={y} className="year-bar" title={`${y} : ${yc[y] || 0} décision(s)`}>
                <div className="year-bar-fill" style={{ height: `${Math.round(((yc[y] || 0) / yMax) * 100)}%` }} />
                <span className="year-lbl">{allYears.length <= 18 || y % 5 === 0 ? `’${String(y).slice(2)}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Répartition par juridiction</h3>
      <div className="insight-chips">
        {courts.map(([label, n]) => <span key={label} className="chip">{label} · {n}</span>)}
      </div>

      <h3>Décisions ({p.cases_count})</h3>
      <div className="insight-cases">
        {p.cases.map((c) => <CaseRow key={c.doc_id} c={c} />)}
      </div>
    </div>
  );
}

function CaseRow({ c }: { c: InsightCase }) {
  const meta = [jurisRef(c.doc_id), jurisDate(c.doc_id) || (c.year ? String(c.year) : null)].filter(Boolean).join(' · ');
  return (
    <a className="case-row" href={`/docs/${c.doc_id}.pdf`} target="_blank" rel="noopener noreferrer">
      <span className="case-court">{jurisCourt(c.doc_id, c.juridiction_key)}</span>
      <span className="case-meta muted">{meta}</span>
      <span className="case-open">PDF ↗</span>
    </a>
  );
}

function yearsSpan(a: number | null, b: number | null): string {
  if (!a && !b) return '—';
  if (a && b && a !== b) return `${a}–${b}`;
  return String(a || b);
}
