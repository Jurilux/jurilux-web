import { useEffect, useState, FormEvent } from 'react';
import {
  insightStats, insightMatters, insightLawyers, insightLawyer, adminLogin, logout, getStoredEmail, HttpError,
  InsightLawyer, InsightProfile, InsightCase, InsightMatter,
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
  const [sort, setSort] = useState('cases');
  const [matter, setMatter] = useState('');
  const [matterList, setMatterList] = useState<InsightMatter[]>([]);
  const [list, setList] = useState<InsightLawyer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<InsightProfile | null>(null);
  const [compare, setCompare] = useState<InsightProfile | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => { insightMatters().then(setMatterList).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      insightLawyers(q, 100, sort, matter).then(setList).finally(() => setLoading(false));
    }, q ? 280 : 0);
    return () => clearTimeout(t);
  }, [q, sort, matter]);

  const open = (k: string) => insightLawyer(k).then((p) => { setSel(p); setCompare(null); });
  const maxCases = list && list.length ? Math.max(...list.map((l) => l.cases)) : 1;
  const sortLabel = sort === 'recent' ? 'activité récente' : sort === 'winrate' ? 'taux estimé favorable' : 'nombre de décisions';

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

        {compare && sel ? (
          <CompareView a={sel} b={compare} onClose={() => setCompare(null)} />
        ) : comparing && sel ? (
          <ComparePicker exclude={sel.name_key}
            onPick={(k) => { insightLawyer(k).then(setCompare); setComparing(false); }}
            onCancel={() => setComparing(false)} />
        ) : sel ? (
          <Profile p={sel} onBack={() => { setSel(null); setCompare(null); }}
            onOpen={open} onCompare={() => setComparing(true)} />
        ) : (
          <>
            {stats && (
              <p className="muted insight-stats">
                <b>{stats.lawyers.toLocaleString('fr-FR')}</b> avocats indexés ·
                {' '}<b>{stats.appearances.toLocaleString('fr-FR')}</b> apparitions
              </p>
            )}
            <div className="insight-toolbar">
              <input className="insight-search" placeholder="Rechercher un avocat…" value={q}
                onChange={(e) => setQ(e.target.value)} autoFocus />
              <select value={matter} onChange={(e) => setMatter(e.target.value)} title="Filtrer par domaine">
                <option value="">Tous les domaines</option>
                {matterList.map((m) => <option key={m.name} value={m.name}>{m.name} ({m.count})</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value)} title="Trier">
                <option value="cases">Tri : nb décisions</option>
                <option value="recent">Tri : activité récente</option>
                <option value="winrate">Tri : taux estimé favorable</option>
              </select>
            </div>
            {list && (
              <p className="insight-count muted">
                {list.length}{list.length === 100 ? '+' : ''} résultat{list.length > 1 ? 's' : ''}
                {matter ? ` en « ${matter} »` : ''} · triés par {sortLabel}
              </p>
            )}
            {loading && !list ? <p className="muted">Chargement…</p> : (
              <ol className="insight-list">
                {(list || []).map((l, i) => (
                  <li key={l.name_key}>
                    <button className="lw-row" onClick={() => open(l.name_key)}>
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

function Profile({ p, onBack, onOpen, onCompare }: {
  p: InsightProfile; onBack: () => void; onOpen: (key: string) => void; onCompare: () => void;
}) {
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
  const winPct = p.decided > 0 ? Math.round((p.won / p.decided) * 100) : null;

  return (
    <div className="insight-profile">
      <div className="prof-top">
        <button className="back linklike" onClick={onBack}>← Tous les avocats</button>
        <div className="prof-actions">
          <button className="ghost" onClick={onCompare}>⚖ Comparer</button>
          <button className="ghost" onClick={() => exportCsv(p)}>⬇ Export CSV</button>
        </div>
      </div>
      <h2>{p.name}</h2>
      {p.matters.length > 0 && (
        <div className="insight-chips prof-matters">
          {p.matters.slice(0, 6).map((m) => (
            <span key={m.name} className="chip matter-chip">{m.name} <span className="cochip-n">{m.count}</span></span>
          ))}
        </div>
      )}
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-label">décisions</div><div className="stat-value">{p.cases_count}</div></div>
        <div className="stat-tile"><div className="stat-label">période</div><div className="stat-value">{yearsSpan(p.first_year, p.last_year)}</div></div>
        <div className="stat-tile"><div className="stat-label">juridictions</div><div className="stat-value">{courts.length}</div></div>
        <div className="stat-tile"><div className="stat-label">issue estimée<sup>*</sup></div>
          <div className="stat-value">{winPct == null ? '—' : `${winPct}%`}</div></div>
      </div>

      {(p.as_demandeur > 0 || p.as_defendeur > 0) && (
        <p className="insight-positions muted">
          Positions : <b>{p.as_demandeur}</b> fois côté demandeur/appelant ·
          {' '}<b>{p.as_defendeur}</b> fois côté défendeur/intimé
        </p>
      )}

      <h3>Issue estimée <span className="est-tag" title="Estimation heuristique à partir du dispositif — indicative, jamais certaine (gains partiels, renvois…).">indicatif</span></h3>
      {p.decided > 0 ? (
        <>
          <div className="wl-bar" aria-hidden="true">
            <span className="wl-won" style={{ width: `${(p.won / p.decided) * 100}%` }} />
            <span className="wl-lost" style={{ width: `${(p.lost / p.decided) * 100}%` }} />
          </div>
          <p className="muted wl-legend">
            <b className="wl-dot-won" /> {p.won} estimée{p.won > 1 ? 's' : ''} favorable{p.won > 1 ? 's' : ''} ·
            {' '}<b className="wl-dot-lost" /> {p.lost} défavorable{p.lost > 1 ? 's' : ''}
            {' '}— sur {p.decided} décision{p.decided > 1 ? 's' : ''} à issue estimable (/{p.cases_count}).
            {' '}<i>Estimation heuristique, indicative.</i>
          </p>
        </>
      ) : (
        <p className="muted">Issue non estimable sur ces décisions (dispositif non concluant).</p>
      )}

      {p.cocounsel.length > 0 && (
        <>
          <h3>Confrères récurrents</h3>
          <div className="insight-chips">
            {p.cocounsel.map((cc) => (
              <button key={cc.name_key} className={`cochip rel-${cc.relation}`} onClick={() => onOpen(cc.name_key)}
                title={`${cc.count} affaire(s) en commun · ${cc.relation}`}>
                {cc.name} <span className="cochip-n">{cc.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

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
      {c.side && <span className={`case-side side-${c.side}`}>{c.side === 'A' ? 'demandeur' : 'défendeur'}</span>}
      {c.won === 1 && <span className="case-out out-won" title="issue estimée favorable">✓</span>}
      {c.won === 0 && <span className="case-out out-lost" title="issue estimée défavorable">✗</span>}
      <span className="case-meta muted">{meta}</span>
      <span className="case-open">PDF ↗</span>
    </a>
  );
}

function exportCsv(p: InsightProfile) {
  const head = ['decision', 'juridiction', 'annee', 'cote', 'issue_estimee', 'domaine', 'pdf'];
  const lines = p.cases.map((c) => [
    c.doc_id, jurisCourt(c.doc_id, c.juridiction_key), c.year ?? '',
    c.side === 'A' ? 'demandeur' : c.side === 'B' ? 'defendeur' : '',
    c.won === 1 ? 'favorable (estime)' : c.won === 0 ? 'defavorable (estime)' : '',
    c.matter ?? '', `${location.origin}/docs/${c.doc_id}.pdf`,
  ]);
  const csv = [head, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `insight-${p.name_key.replace(/\s+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function CompareView({ a, b, onClose }: { a: InsightProfile; b: InsightProfile; onClose: () => void }) {
  const win = (p: InsightProfile) => (p.decided > 0 ? `${Math.round((p.won / p.decided) * 100)} %` : '—');
  const rows: [string, (p: InsightProfile) => string | number][] = [
    ['Décisions', (p) => p.cases_count],
    ['Période', (p) => yearsSpan(p.first_year, p.last_year)],
    ['Domaine principal', (p) => p.matters[0]?.name || '—'],
    ['Côté demandeur / défendeur', (p) => `${p.as_demandeur} / ${p.as_defendeur}`],
    ['Issue estimée favorable', win],
    ['Décisions à issue estimable', (p) => p.decided],
  ];
  return (
    <div className="insight-compare">
      <button className="back linklike" onClick={onClose}>← Retour au profil</button>
      <h2>Comparaison</h2>
      <div className="table-wrap">
        <table className="compare-table">
          <thead><tr><th></th><th>{a.name}</th><th>{b.name}</th></tr></thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label}><td className="cmp-label">{label}</td><td>{f(a)}</td><td>{f(b)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted wl-legend"><i>Taux estimé = heuristique indicative sur le dispositif.</i></p>
    </div>
  );
}

function ComparePicker({ exclude, onPick, onCancel }: {
  exclude: string; onPick: (key: string) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<InsightLawyer[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      insightLawyers(q, 30).then((r) => setRes(r.filter((x) => x.name_key !== exclude)));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, exclude]);
  return (
    <div className="insight-picker">
      <button className="back linklike" onClick={onCancel}>← Annuler</button>
      <h3>Comparer à…</h3>
      <input className="insight-search" placeholder="Rechercher le 2ᵉ avocat…" value={q} autoFocus
        onChange={(e) => setQ(e.target.value)} />
      <ol className="insight-list">
        {res.map((l) => (
          <li key={l.name_key}>
            <button className="lw-row lw-row-simple" onClick={() => onPick(l.name_key)}>
              <span className="lw-name">{l.name}</span>
              <span className="lw-count">{l.cases}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function yearsSpan(a: number | null, b: number | null): string {
  if (!a && !b) return '—';
  if (a && b && a !== b) return `${a}–${b}`;
  return String(a || b);
}
