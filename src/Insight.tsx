import { useEffect, useState, FormEvent } from 'react';
import {
  insightStats, insightMatters, insightLawyers, insightLawyer, insightAnalytics,
  insightFirms, insightFirm, insightArticles, insightRgpdRequest, insightExportUrl,
  InsightLawyer, InsightProfile, InsightCase, InsightMatter, Analytics, AnalyticsRow,
  InsightFirm, InsightFirmProfile, InsightArticle,
} from './api';
import { jurisCourt, jurisDate, jurisRef } from './juridictions';

// Étape du parcours de découverte : un avocat ou une matière (avec l'avocat d'où l'on vient).
type AvStep =
  | { kind: 'lawyer'; p: InsightProfile }
  | { kind: 'matter'; name: string; from?: InsightProfile };

// Fil d'Ariane du parcours : Avocats → Maître X → Droit du travail → Maître Y…
function Crumbs({ stack, onJump }: { stack: AvStep[]; onJump: (len: number) => void }) {
  return (
    <nav className="crumbs" aria-label="Parcours">
      <button className="crumb" onClick={() => onJump(0)}>Avocats</button>
      {stack.map((st, i) => (
        <span key={i} className="crumb-seg">
          <span className="crumb-sep">›</span>
          {i === stack.length - 1
            ? <span className="crumb crumb-cur">{st.kind === 'lawyer' ? st.p.name : st.name}</span>
            : <button className="crumb" onClick={() => onJump(i + 1)}>{st.kind === 'lawyer' ? st.p.name : st.name}</button>}
        </span>
      ))}
    </nav>
  );
}

// Tendance d'un avocat dans une matière : activité des 2 dernières années vs les 2 précédentes.
function matterTrend(cases: InsightCase[], matter: string): -1 | 0 | 1 {
  const yrs = cases.filter((c) => c.matter === matter && c.year).map((c) => c.year as number);
  if (yrs.length < 2) return 0;
  const ref = Math.max(...yrs);
  const recent = yrs.filter((y) => y >= ref - 1).length;
  const before = yrs.filter((y) => y < ref - 1 && y >= ref - 3).length;
  return recent > before ? 1 : recent < before ? -1 : 0;
}

function TrendArrow({ cases, matter }: { cases: InsightCase[]; matter: string }) {
  const t = matterTrend(cases, matter);
  if (t === 0) return null;
  return <span className={`trend-arrow ${t > 0 ? 'up' : 'down'}`}
    title={t > 0 ? 'Activité en hausse (2 dernières années vs 2 précédentes)' : 'Activité en baisse'}>
    {t > 0 ? '▲' : '▼'}</span>;
}

// ---------- Vue MATIÈRE du parcours : tendances du domaine + avocats liés ----------
// C'est le pont entre les jeux de données : depuis un avocat on ouvre une de SES matières,
// on y lit les tendances du domaine (volume, taux, montants, années) et on rebondit sur
// les AUTRES avocats actifs dans cette matière.
function MatterJourney({ name, from, onOpenLawyer }: {
  name: string; from?: InsightProfile; onOpenLawyer: (key: string) => void;
}) {
  const [an, setAn] = useState<Analytics | null>(null);
  const [lawyers, setLawyers] = useState<InsightLawyer[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    setAn(null); setLawyers(null); setErr(false);
    Promise.all([insightAnalytics(name), insightLawyers('', 30, 'cases', name)])
      .then(([a, l]) => { setAn(a); setLawyers(l); })
      .catch(() => setErr(true));
  }, [name]);

  if (err) return <p className="warn">⚠ Impossible de charger la matière.</p>;
  if (!an || !lawyers) return <p className="muted">Chargement de la matière…</p>;

  const o = an.overall;
  // Position de l'avocat d'origine DANS cette matière (calculée sur ses décisions).
  let fromLine: JSX.Element | null = null;
  if (from) {
    const cs = from.cases.filter((c) => c.matter === name);
    const won = cs.filter((c) => c.won === 1).length;
    const dec = cs.filter((c) => c.won === 0 || c.won === 1).length;
    const rate = dec ? won / dec : null;
    const diff = rate != null && o.win_rate != null ? Math.round((rate - o.win_rate) * 100) : null;
    fromLine = (
      <div className="insight-note from-note">
        <b>{from.name}</b> dans cette matière : <b>{cs.length}</b> décision{cs.length > 1 ? 's' : ''}
        {rate != null && <> · <b>{Math.round(rate * 100)} %</b> d'issues estimées favorables</>}
        {diff != null && diff !== 0 && (
          <span className={`trend-arrow ${diff > 0 ? 'up' : 'down'}`}>
            {' '}({diff > 0 ? '+' : ''}{diff} pts vs moyenne de la matière)
          </span>
        )}
        <TrendArrow cases={from.cases} matter={name} />
      </div>
    );
  }

  // Volume par année de la matière (barres, même langage visuel que le profil).
  const years = an.by_year.filter((r) => typeof r.cle === 'number')
    .map((r) => ({ y: r.cle as number, n: r.cases })).sort((a, b) => a.y - b.y);
  const yMax = Math.max(1, ...years.map((r) => r.n));

  return (
    <div className="insight-profile matter-journey">
      <h2>{name} <span className="muted small">— tendances de la matière</span></h2>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-label">affaires</div><div className="stat-value">{o.cases.toLocaleString('fr-FR')}</div></div>
        <div className="stat-tile"><div className="stat-label">taux de succès<sup>*</sup></div><div className="stat-value">{pctFmt(o.win_rate)}</div></div>
        {o.amount_median != null && (
          <div className="stat-tile"><div className="stat-label">montant médian<sup>*</sup></div><div className="stat-value">{euroFmt(o.amount_median)}</div></div>
        )}
        {o.delai_median != null && (
          <div className="stat-tile"><div className="stat-label">délai médian<sup>*</sup></div><div className="stat-value">{delaiFmt(o.delai_median)}</div></div>
        )}
        <div className="stat-tile"><div className="stat-label">avocats actifs</div><div className="stat-value">{o.lawyers.toLocaleString('fr-FR')}</div></div>
      </div>

      {fromLine}

      {years.length > 1 && (
        <>
          <h3>Volume par année</h3>
          <div className="year-chart">
            {years.map((r) => (
              <div key={r.y} className="year-bar" title={`${r.y} : ${r.n} décision(s)`}>
                <div className="year-bar-fill" style={{ height: `${Math.round((r.n / yMax) * 100)}%` }} />
                <span className="year-lbl">{years.length <= 18 || r.y % 5 === 0 ? `’${String(r.y).slice(2)}` : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3>Avocats liés à cette matière</h3>
      <p className="muted small">Classés par volume dans « {name} » — cliquez pour continuer le parcours sur un profil.</p>
      <ol className="insight-list">
        {(() => { const mx = Math.max(1, ...lawyers.map((x) => x.cases)); return lawyers.map((l, i) => {
          const isFrom = from && l.name_key === from.name_key;
          const rate = l.decided ? (l.won || 0) / l.decided : null;
          return (
            <li key={l.name_key}>
              <button className={`lw-row ${isFrom ? 'lw-row-from' : ''}`}
                onClick={() => !isFrom && onOpenLawyer(l.name_key)} disabled={!!isFrom}>
                <span className="rank">#{i + 1}</span>
                <span className="lw-name">{l.name}{isFrom ? ' — vous y êtes' : ''}</span>
                <span className="lw-bar" aria-hidden="true">
                  <span className="lw-bar-fill" style={{ width: `${Math.max(4, Math.round((l.cases / mx) * 100))}%` }} />
                </span>
                <span className="lw-count">{l.cases}</span>
                <span className="lw-period muted">{rate != null ? pctFmt(rate) : '—'}</span>
              </button>
            </li>
          );
        }); })()}
      </ol>
      <p className="muted wl-legend"><sup>*</sup> Indicateurs estimés (heuristiques), indicatifs.</p>
    </div>
  );
}

function InsightMain({ stats }: { stats: { lawyers: number; appearances: number } | null }) {
  const [view, setView] = useState<'avocats' | 'cabinets' | 'analytics' | 'methodo'>('avocats');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('cases');
  const [matter, setMatter] = useState('');
  const [matterList, setMatterList] = useState<InsightMatter[]>([]);
  const [list, setList] = useState<InsightLawyer[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [loading, setLoading] = useState(false);
  // PARCOURS DE DÉCOUVERTE : pile de navigation avocat ↔ matière (fil d'Ariane cliquable).
  // Chaque étape garde son contexte : depuis un profil on explore une matière (tendances +
  // avocats liés), depuis la matière on rebondit sur un confrère, etc.
  const [stack, setStack] = useState<AvStep[]>([]);
  const top = stack.length ? stack[stack.length - 1] : null;
  const sel = top?.kind === 'lawyer' ? top.p : null;
  const push = (st: AvStep) => setStack((prev) => [...prev, st]);
  const [compare, setCompare] = useState<InsightProfile | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => { insightMatters().then(setMatterList).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      insightLawyers(q, 100, sort, matter)
        .then((r) => { setList(r); setLoadErr(false); })
        .catch(() => { setList([]); setLoadErr(true); })
        .finally(() => setLoading(false));
    }, q ? 280 : 0);
    return () => clearTimeout(t);
  }, [q, sort, matter]);

  const open = (k: string) => insightLawyer(k).then((p) => { push({ kind: 'lawyer', p }); setCompare(null); });
  const maxCases = list && list.length ? Math.max(...list.map((l) => l.cases)) : 1;
  const sortLabel = sort === 'recent' ? 'activité récente' : sort === 'winrate' ? 'taux estimé favorable' : 'nombre de décisions';

  return (
    <div className="insight insight-embedded">
      <header className="insight-tabsbar">
        <div className="admin-tabs">
          <button className={`ghost ${view === 'avocats' ? 'active' : ''}`}
            onClick={() => setView('avocats')}>Avocats</button>
          <button className={`ghost ${view === 'cabinets' ? 'active' : ''}`}
            onClick={() => setView('cabinets')}>Cabinets</button>
          <button className={`ghost ${view === 'analytics' ? 'active' : ''}`}
            onClick={() => setView('analytics')}>Analytics contentieux</button>
          <button className={`ghost ${view === 'methodo' ? 'active' : ''}`}
            onClick={() => setView('methodo')}>Méthodologie & RGPD</button>
        </div>
      </header>
      <main className="admin-main">
        {view === 'methodo' ? <MethodoView /> :
         view === 'cabinets' ? <FirmsView onOpenLawyer={(k) => { setView('avocats'); open(k); }} /> :
         view === 'analytics' ? <AnalyticsView /> : (
        <>
        <div className="insight-note">
          <b>Profilage limité aux avocats</b>, à partir des décisions <b>publiques</b> de jurisprudence.
          Usage interne (base légale : intérêt légitime — aucune rediffusion). Volontairement <b>pas</b> de
          magistrats ni de greffiers.
        </div>

        {stack.length > 0 && (
          <Crumbs stack={stack} onJump={(i) => { setStack(stack.slice(0, i)); setCompare(null); setComparing(false); }} />
        )}
        {compare && sel ? (
          <CompareView a={sel} b={compare} onClose={() => setCompare(null)} />
        ) : comparing && sel ? (
          <ComparePicker exclude={sel.name_key}
            onPick={(k) => { insightLawyer(k).then(setCompare); setComparing(false); }}
            onCancel={() => setComparing(false)} />
        ) : top?.kind === 'matter' ? (
          <MatterJourney name={top.name} from={top.from} onOpenLawyer={open} />
        ) : sel ? (
          <Profile p={sel} onBack={() => { setStack(stack.slice(0, -1)); setCompare(null); }}
            onOpen={open} onCompare={() => setComparing(true)}
            onMatter={(name) => push({ kind: 'matter', name, from: sel })} />
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
              <a className="ghost" href={insightExportUrl(q, sort, matter)}
                title="Exporter la liste filtrée (tableur)">⬇ CSV</a>
            </div>
            {list && (
              <p className="insight-count muted">
                {list.length}{list.length === 100 ? '+' : ''} résultat{list.length > 1 ? 's' : ''}
                {matter ? ` en « ${matter} »` : ''} · triés par {sortLabel}
              </p>
            )}
            {loadErr && <p className="warn">⚠ Impossible de charger les avocats — réessayez (connexion ou service indisponible).</p>}
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
        </>
        )}
      </main>

    </div>
  );
}

function pctFmt(r: number | null): string {
  return r == null ? '—' : `${Math.round(r * 100)} %`;
}

function euroFmt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function delaiFmt(j: number | null | undefined): string {
  if (j == null) return '—';
  return j >= 60 ? `${Math.round(j / 30)} mois` : `${j} j`;
}

function AnalyticsTable({ title, rows }: { title: string; rows: AnalyticsRow[] }) {
  const hasAmounts = rows.some((r) => r.amount_median != null);
  return (
    <>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">Aucune donnée.</p>
      ) : (
        <div className="table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th></th>
                <th>affaires</th>
                <th>estimées</th>
                <th>gagnées</th>
                <th>taux</th>
                {hasAmounts && <th>montant méd.<sup>*</sup></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.cle)}>
                  <td className="cmp-label">{r.cle}</td>
                  <td>{r.cases}</td>
                  <td>{r.decided}</td>
                  <td>{r.won}</td>
                  <td>{pctFmt(r.win_rate)}</td>
                  {hasAmounts && <td title={r.amount_n ? `sur ${r.amount_n} décision(s) à montant détecté` : ''}>{euroFmt(r.amount_median)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    insightAnalytics()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Chargement…</p>;
  if (error) return <p className="warn">⚠ {error}</p>;
  if (!data) return <p className="muted">Aucune donnée.</p>;

  const o = data.overall;
  return (
    <div className="insight-analytics">
      <h2>Analytics contentieux</h2>
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-label">affaires</div><div className="stat-value">{o.cases.toLocaleString('fr-FR')}</div></div>
        <div className="stat-tile"><div className="stat-label">issues estimables</div><div className="stat-value">{o.decided.toLocaleString('fr-FR')}</div></div>
        <div className="stat-tile"><div className="stat-label">gagnées</div><div className="stat-value">{o.won.toLocaleString('fr-FR')}</div></div>
        <div className="stat-tile"><div className="stat-label">taux de succès<sup>*</sup></div><div className="stat-value">{pctFmt(o.win_rate)}</div></div>
        <div className="stat-tile"><div className="stat-label">avocats</div><div className="stat-value">{o.lawyers.toLocaleString('fr-FR')}</div></div>
        {o.amount_median != null && (
          <div className="stat-tile" title={`médiane sur ${o.amount_n ?? '?'} décision(s) à montant détecté — indicatif`}>
            <div className="stat-label">montant médian<sup>*</sup></div><div className="stat-value">{euroFmt(o.amount_median)}</div>
          </div>
        )}
        {o.delai_median != null && (
          <div className="stat-tile" title={`médiane sur ${o.delai_n ?? '?'} décision(s) à délai estimable — indicatif`}>
            <div className="stat-label">délai médian<sup>*</sup></div><div className="stat-value">{delaiFmt(o.delai_median)}</div>
          </div>
        )}
      </div>

      <AnalyticsTable title="Par matière" rows={data.by_matter} />
      <AnalyticsTable title="Par juridiction" rows={data.by_juridiction} />
      <AnalyticsTable title="Par année" rows={data.by_year} />
      <ArticlesTable />

      <p className="muted wl-legend">
        <sup>*</sup> Taux de succès, montants et délais <b>estimés</b> (indicatifs — heuristiques sur le
        dispositif), données publiques de jurisprudence, avocats/parties uniquement — jamais de magistrats.
      </p>
    </div>
  );
}

// Textes de loi les plus visés dans les décisions analysées (extraction déterministe).
function ArticlesTable() {
  const [rows, setRows] = useState<InsightArticle[] | null>(null);
  useEffect(() => { insightArticles(15).then(setRows).catch(() => setRows([])); }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <>
      <h3>Articles les plus visés</h3>
      <div className="table-wrap">
        <table className="compare-table">
          <thead><tr><th>article / texte</th><th>décisions</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.article}><td className="cmp-label">{a.article}</td><td>{a.decisions}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Cabinets (dimension B2B) : uniquement les cabinets EXPLICITEMENT nommés ----------
function FirmsView({ onOpenLawyer }: { onOpenLawyer: (key: string) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<InsightFirm[] | null>(null);
  const [sel, setSel] = useState<InsightFirmProfile | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { insightFirms(q, 80).then(setList).catch(() => setList([])); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]);

  if (sel) {
    return (
      <div className="insight-profile">
        <button className="back linklike" onClick={() => setSel(null)}>← Tous les cabinets</button>
        <h2>{sel.firm}</h2>
        <div className="stat-grid">
          <div className="stat-tile"><div className="stat-label">décisions</div><div className="stat-value">{sel.cases_count}</div></div>
          <div className="stat-tile"><div className="stat-label">avocats</div><div className="stat-value">{sel.lawyers_count}</div></div>
          <div className="stat-tile"><div className="stat-label">issue estimée<sup>*</sup></div><div className="stat-value">{pctFmt(sel.win_rate)}</div></div>
          <div className="stat-tile"><div className="stat-label">période</div><div className="stat-value">{yearsSpan(sel.first_year, sel.last_year)}</div></div>
          {sel.amount_median != null && (
            <div className="stat-tile"><div className="stat-label">montant médian<sup>*</sup></div><div className="stat-value">{euroFmt(sel.amount_median)}</div></div>
          )}
        </div>
        {sel.matters.length > 0 && (
          <div className="insight-chips prof-matters">
            {sel.matters.slice(0, 6).map((m) => (
              <span key={m.name} className="chip matter-chip">{m.name} <span className="cochip-n">{m.count}</span></span>
            ))}
          </div>
        )}
        <h3>Avocats du cabinet</h3>
        <ol className="insight-list">
          {sel.lawyers.map((l) => (
            <li key={l.name_key}>
              <button className="lw-row lw-row-simple" onClick={() => onOpenLawyer(l.name_key)}>
                <span className="lw-name">{l.name}</span>
                <span className="lw-count">{l.cases}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="muted wl-legend"><i>Cabinets = mentions EXPLICITES (« Étude X ») — couverture partielle du corpus. Taux/montants estimés, indicatifs.</i></p>
      </div>
    );
  }

  return (
    <div className="insight-firms">
      <div className="insight-note">
        <b>Cabinets explicitement nommés</b> dans les décisions (« Étude X », « Cabinet Y ») — couverture
        partielle : beaucoup de décisions ne citent que l'avocat. Mêmes garde-fous que les avocats.
      </div>
      <div className="insight-toolbar">
        <input className="insight-search" placeholder="Rechercher un cabinet…" value={q}
          onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {!list ? <p className="muted">Chargement…</p> : list.length === 0 ? (
        <p className="muted insight-empty">Aucun cabinet{q ? ` pour « ${q} »` : ' détecté (le build insight n’a peut-être pas encore tourné)'}.</p>
      ) : (
        <div className="table-wrap">
          <table className="compare-table">
            <thead><tr><th>cabinet</th><th>décisions</th><th>avocats</th><th>taux estimé<sup>*</sup></th><th></th></tr></thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.firm}>
                  <td className="cmp-label">{f.firm}</td>
                  <td>{f.cases}</td>
                  <td>{f.lawyers}</td>
                  <td>{pctFmt(f.win_rate)}</td>
                  <td><button className="linklike" onClick={() => insightFirm(f.firm).then(setSel)}>ouvrir →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Méthodologie & droits RGPD (jurimétrie, base légale, opposition) ----------
function MethodoView() {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('opposition');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('busy');
    try { await insightRgpdRequest(name.trim(), kind, email.trim(), message.trim()); setState('done'); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : 'Échec'); setState('err'); }
  };

  return (
    <div className="insight-methodo">
      <h2>Méthodologie & droits RGPD</h2>
      <div className="insight-note">
        <p><b>Jurimétrie, pas justice prédictive.</b> Les indicateurs (issue estimée, montants, délais)
        sont des <b>statistiques indicatives</b> produites par des heuristiques déterministes (regex sur le
        dispositif des décisions publiques) — aucune IA générative, aucune certitude, aucun pronostic.</p>
        <p><b>Périmètre :</b> avocats (« Maître X ») et cabinets explicitement nommés, à partir de la
        jurisprudence <b>publique</b> (open-data). <b>Jamais de magistrats ni de greffiers</b> (art. 33 de
        la loi française 2019-222 pour comparaison ; position CNPD). Base légale : intérêt légitime,
        données déjà publiques, finalité d'information professionnelle.</p>
        <p><b>Limites connues :</b> homonymies possibles, issue « gagné/perdu » simplificatrice (gains
        partiels, renvois), montants détectés sur une fraction des décisions seulement.</p>
      </div>

      <h3>Exercer vos droits (avocat profilé)</h3>
      <p className="muted">Accès, rectification ou opposition au profilage de votre nom — traité manuellement, réponse sous 30 jours.</p>
      {state === 'done' ? (
        <p className="insight-note">✅ <b>Demande enregistrée.</b> Elle sera traitée dans les meilleurs délais.</p>
      ) : (
        <form className="auth-form rgpd-form" onSubmit={submit}>
          <label>Nom concerné (tel qu'affiché)
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Maître Prénom NOM" />
          </label>
          <label>Demande
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="opposition">Opposition au profilage</option>
              <option value="rectification">Rectification</option>
              <option value="acces">Accès à mes données</option>
            </select>
          </label>
          <label>E-mail de contact (optionnel)
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.lu" />
          </label>
          <label>Précisions (optionnel)
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
          </label>
          {state === 'err' && <p className="warn">⚠ {err}</p>}
          <button className="send" disabled={state === 'busy'}>{state === 'busy' ? '…' : 'Envoyer la demande'}</button>
        </form>
      )}
    </div>
  );
}

function Profile({ p, onBack, onOpen, onCompare, onMatter }: {
  p: InsightProfile; onBack: () => void; onOpen: (key: string) => void; onCompare: () => void;
  onMatter: (name: string) => void;
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
      {p.firm && <p className="muted insight-firm">Cabinet : <b>{p.firm}</b></p>}
      {p.matters.length > 0 && (
        <>
          <div className="insight-chips prof-matters">
            {p.matters.slice(0, 6).map((m) => (
              <button key={m.name} className="chip matter-chip matter-link"
                title={`Explorer « ${m.name} » : tendances de la matière et avocats liés`}
                onClick={() => onMatter(m.name)}>
                {m.name} <span className="cochip-n">{m.count}</span>
                <TrendArrow cases={p.cases} matter={m.name} />
                <span className="chip-go">→</span>
              </button>
            ))}
          </div>
          <p className="muted small matters-hint">Cliquez une matière pour voir ses tendances et les avocats qui y sont actifs.</p>
        </>
      )}
      <div className="stat-grid">
        <div className="stat-tile"><div className="stat-label">décisions</div><div className="stat-value">{p.cases_count}</div></div>
        <div className="stat-tile"><div className="stat-label">période</div><div className="stat-value">{yearsSpan(p.first_year, p.last_year)}</div></div>
        <div className="stat-tile"><div className="stat-label">juridictions</div><div className="stat-value">{courts.length}</div></div>
        <div className="stat-tile"><div className="stat-label">issue estimée<sup>*</sup></div>
          <div className="stat-value">{winPct == null ? '—' : `${winPct}%`}</div></div>
        {p.amount_median != null && (
          <div className="stat-tile" title={`médiane sur ${p.amount_n} décision(s) à montant détecté — indicatif`}>
            <div className="stat-label">montant médian<sup>*</sup></div>
            <div className="stat-value">{euroFmt(p.amount_median)}</div>
          </div>
        )}
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

// Panneau Insight INTÉGRÉ à l'app (vue interne, même coquille/sidebar — pas de page à part).
export function InsightEmbedded() {
  const [stats, setStats] = useState<{ lawyers: number; appearances: number } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { insightStats().then(setStats).catch(() => setErr(true)); }, []);
  return (
    <>
      {err && <p className="warn">⚠ Le module Insight ne répond pas — les listes peuvent être vides. Rechargez la page ou réessayez plus tard.</p>}
      <InsightMain stats={stats} />
    </>
  );
}
