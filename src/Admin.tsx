import { useEffect, useState, FormEvent, lazy, Suspense } from 'react';
import {
  adminOverview, adminUsers, adminQuestions, adminFeedback, adminActivity, adminProbe, adminEval,
  adminSetPlan, adminSetAdmin, adminDeleteUser,
  adminHealth, adminGetConfig, adminPatchConfig, adminAudit, adminPurge,
  adminTests, adminTestsRun, adminTestsImport, AdminTests, FSection, FRes,
  adminTestsCatalogue, TestsCatalogue, CatParcours, CatCas,
  logout, HttpError,
  AdminOverview, AdminUser, AdminQuestion, AdminFeedback, ActivityDay, ProbeHit, EvalReport,
  AdminHealth, AuditEntry,
} from './api';

const Documentation = lazy(() => import('./Documentation'));

type Phase = 'loading' | 'login' | 'denied' | 'ready';
type Tab = 'dashboard' | 'inspector' | 'eval' | 'users' | 'questions' | 'feedback' | 'corpus'
  | 'health' | 'config' | 'audit' | 'tests' | 'docs';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

// ---------- formatage ----------
const fmtNum = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('fr-FR');

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${Math.round(seconds)} s`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR') + ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtAgo(seconds: number | null | undefined): string {
  if (seconds == null) return 'jamais';
  if (seconds < 60) return `il y a ${Math.round(seconds)} s`;
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.round(seconds / 3600)} h`;
  return `il y a ${Math.round(seconds / 86400)} j`;
}

// ---------- reconnexion ----------
// Plus de formulaire de connexion DÉDIÉ au backoffice : tout le site passe déjà par le mur
// d'authentification unique (AuthGate). L'admin réutilise donc la MÊME session — aucune double
// connexion. Ce panneau n'apparaît qu'en cas de session expirée en cours de route : il renvoie
// au mur unique plutôt que de dupliquer un second login.
function AdminReconnect() {
  return (
    <div className="admin-gate">
      <div className="admin-login">
        <div className="admin-brand"><span className="logo">⚖</span><strong>Jurilux</strong>
          <span className="admin-tag">Backoffice</span></div>
        <p className="muted">Votre session a expiré.</p>
        <button className="send" onClick={() => { window.location.href = '/'; }}>Se reconnecter</button>
      </div>
    </div>
  );
}

// ---------- tableau de bord ----------
function StatTile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'ok' | 'warn' | 'ko';
}) {
  return (
    <div className={`stat-tile${tone ? ` tone-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function ActivityChart() {
  const [days, setDays] = useState<ActivityDay[] | null>(null);
  useEffect(() => { adminActivity().then(setDays).catch(() => setDays([])); }, []);
  if (!days) return null;
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((a, d) => a + d.count, 0);
  return (
    <div className="panel">
      <div className="panel-title">Activité — questions par jour ({total} sur la période)</div>
      {days.length === 0 ? (
        <p className="muted small">Aucune question loguée sur la période.</p>
      ) : (
        <div className="bars">
          {days.map((d) => (
            <div className="bar-col" key={d.date} title={`${d.date} · ${d.count}`}>
              <div className="bar-fill-v" style={{ height: `${Math.round((d.count / max) * 100)}%` }} />
              <div className="bar-x">{d.date.slice(8)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Dashboard({ ov }: { ov: AdminOverview }) {
  const m = ov.metrics;
  const refusalPct = m.refusal_rate == null ? null : Math.round(m.refusal_rate * 100);
  const latency = m.ask_latency_ms_avg == null ? null : (m.ask_latency_ms_avg / 1000);
  return (
    <div className="tab-body">
      <div className="stat-grid">
        <StatTile label="Questions (total)" value={fmtNum(m.ask_total)}
          hint={`dernière ${fmtAgo(m.last_ask_ago_s)}`} />
        <StatTile label="Taux de refus" value={refusalPct == null ? '—' : `${refusalPct} %`}
          hint={`${fmtNum(m.ask_refused)} refus`} tone={refusalPct != null && refusalPct > 30 ? 'warn' : undefined} />
        <StatTile label="Latence moyenne" value={latency == null ? '—' : `${latency.toFixed(1)} s`}
          hint="200 dernières" tone={latency != null && latency > 10 ? 'warn' : undefined} />
        <StatTile label="dont recherche" value={m.search_ms_avg == null ? '—' : `${(m.search_ms_avg / 1000).toFixed(1)} s`}
          hint={latency && m.search_ms_avg ? `${Math.round(100 * (m.search_ms_avg / 1000) / latency)} % du total` : 'Meili + embedding'} />
        <StatTile label="dont LLM" value={m.llm_ms_avg == null ? '—' : `${(m.llm_ms_avg / 1000).toFixed(1)} s`}
          hint={latency && m.llm_ms_avg ? `${Math.round(100 * (m.llm_ms_avg / 1000) / latency)} % du total` : 'génération Claude'} />
        <StatTile label="Erreurs" value={fmtNum(m.ask_errors)}
          hint={`${fmtNum(m.ask_rate_limited)} rate-limited`} tone={m.ask_errors > 0 ? 'ko' : undefined} />
        <StatTile label="Comptes" value={fmtNum(ov.users.total)}
          hint={`${fmtNum(ov.users.pros)} pro · ${fmtNum(ov.users.admins)} admin`} />
        <StatTile label="Questions 24 h" value={fmtNum(ov.questions.last_24h)}
          hint={`${fmtNum(ov.questions.total)} loguées au total`} />
        <StatTile label="Satisfaction" tone={ov.feedback.satisfaction != null && ov.feedback.satisfaction < 0.5 ? 'warn' : undefined}
          value={ov.feedback.satisfaction == null ? '—' : `${Math.round(ov.feedback.satisfaction * 100)} %`}
          hint={`${fmtNum(ov.feedback.helpful)} 👍 · ${fmtNum(ov.feedback.not_helpful)} 👎`} />
        <StatTile label="Corpus (chunks)" value={fmtNum(ov.corpus.chunks)}
          hint={`index Meili : ${fmtNum(ov.index.documents)}`} />
        <StatTile label="Uptime API" value={fmtDuration(m.uptime_s)}
          hint={`prompt ${ov.prompt_version}`} />
      </div>

      <ActivityChart />

      <div className="panel">
        <div className="panel-title">État système</div>
        <div className="kv-grid">
          <div className="kv"><span>Meilisearch</span>
            <b className={ov.health.meilisearch ? 'ok' : 'ko'}>{ov.health.meilisearch ? 'en ligne' : 'hors ligne'}</b></div>
          <div className="kv"><span>Clé LLM</span>
            <b className={ov.health.llm_configured ? 'ok' : 'ko'}>{ov.health.llm_configured ? 'configurée' : 'absente'}</b></div>
          <div className="kv"><span>Modèle</span><b className="mono">{ov.model}</b></div>
          <div className="kv"><span>Recherche hybride</span>
            <b>{ov.hybrid_semantic_ratio > 0 ? `sémantique ${Math.round(ov.hybrid_semantic_ratio * 100)} %` : 'mots-clés'}</b></div>
          <div className="kv"><span>Indexation en cours</span>
            <b>{ov.index.is_indexing ? 'oui' : 'non'}</b></div>
          <div className="kv"><span>Version front</span><b className="mono">{APP_VERSION}</b></div>
        </div>
      </div>
    </div>
  );
}

// ---------- utilisateurs ----------
function Users() {
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    setError(null);
    adminUsers().then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const act = async (id: number, fn: () => Promise<void>) => {
    setBusyId(id);
    try { await fn(); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Échec'); }
    finally { setBusyId(null); }
  };

  if (error) return <div className="tab-body"><p className="warn">⚠ {error}</p></div>;
  if (!rows) return <div className="tab-body"><p className="muted">Chargement…</p></div>;

  return (
    <div className="tab-body">
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr>
            <th>Email</th><th>Plan</th><th>Questions</th><th>Inscrit</th><th>Admin</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="mono">{u.email}</td>
                <td>
                  <select className="cell-select" value={u.plan} disabled={busyId === u.id}
                    onChange={(e) => act(u.id, () => adminSetPlan(u.id, e.target.value))}>
                    <option value="student">Étudiant</option>
                    <option value="pro">Pro</option>
                  </select>
                </td>
                <td className="num">{fmtNum(u.questions)}</td>
                <td className="muted">{fmtDate(u.created_at)}</td>
                <td>
                  <label className="switch-cell">
                    <input type="checkbox" checked={u.is_admin} disabled={busyId === u.id}
                      onChange={(e) => act(u.id, () => adminSetAdmin(u.id, e.target.checked))} />
                  </label>
                </td>
                <td>
                  <button className="row-del" disabled={busyId === u.id}
                    onClick={() => {
                      if (confirm(`Supprimer le compte ${u.email} ? Cette action est irréversible (historique inclus).`))
                        act(u.id, () => adminDeleteUser(u.id));
                    }}>Supprimer</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Aucun compte.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- questions ----------
function Questions() {
  const [rows, setRows] = useState<AdminQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminQuestions(150).then(setRows).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="tab-body"><p className="warn">⚠ {error}</p></div>;
  if (!rows) return <div className="tab-body"><p className="muted">Chargement…</p></div>;

  const badge = (s: string | null) => {
    const cls = s === 'partial' ? 'st-partial' : s === 'ok' ? 'st-ok' : 'st-other';
    return <span className={`q-status ${cls}`}>{s || '—'}</span>;
  };

  return (
    <div className="tab-body">
      <p className="muted small">Questions des utilisateurs connectés (les recherches anonymes ne sont pas loguées).</p>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>Date</th><th>Compte</th><th>Statut</th><th>Question</th></tr></thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td className="muted nowrap">{fmtDate(q.created_at)}</td>
                <td className="mono nowrap">{q.email}</td>
                <td>{badge(q.status)}</td>
                <td>
                  <div className="q-text">{q.question}</div>
                  {q.answer_preview && <div className="q-preview muted">{q.answer_preview}</div>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">Aucune question loguée.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- inspecteur de récupération ----------
function probeBadge(st: string | null) {
  const cls = st === 'law' ? 'st-law' : st === 'projet_loi' ? 'st-projet' : 'st-juris';
  const label = st === 'law' ? 'Loi' : st === 'projet_loi' ? 'Projet' : 'Jurisprudence';
  return <span className={`probe-badge ${cls}`}>{label}</span>;
}

function InspectorTab() {
  const [q, setQ] = useState('');
  const [topK, setTopK] = useState(12);
  const [hits, setHits] = useState<ProbeHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setError(null);
    try { const d = await adminProbe(q.trim(), topK); setHits(d.hits); }
    catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
    finally { setBusy(false); }
  };

  const counts = (hits || []).reduce((acc, h) => {
    const k = h.source_type || 'autre'; acc[k] = (acc[k] || 0) + 1; return acc;
  }, {} as Record<string, number>);

  return (
    <div className="tab-body">
      <p className="muted small">Voir ce que la <b>recherche</b> remonte pour une requête (sans IA, sans quota) — pour diagnostiquer et valider le retrieval.</p>
      <form className="probe-form" onSubmit={run}>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Ex : conséquences d'une rupture de la période d'essai" />
        <select value={topK} onChange={(e) => setTopK(Number(e.target.value))}>
          {[8, 12, 20, 30].map((n) => <option key={n} value={n}>{n} résultats</option>)}
        </select>
        <button className="send" type="submit" disabled={busy || !q.trim()}>{busy ? '…' : 'Inspecter'}</button>
      </form>

      {error && <p className="warn">⚠ {error}</p>}

      {hits && (
        <>
          <div className="probe-summary">
            {Object.entries(counts).map(([k, n]) => (
              <span key={k} className="probe-count">{probeBadge(k)} {n}</span>
            ))}
            {hits.length === 0 && <span className="muted">Aucun résultat.</span>}
          </div>
          <div className="probe-list">
            {hits.map((h) => (
              <div className={`probe-item probe-${h.source_type || 'autre'}`} key={h.chunk_id}>
                <div className="probe-head">
                  {probeBadge(h.source_type)}
                  <span className="probe-doc mono">{h.doc_id}</span>
                  {h.year && <span className="muted">· {h.year}</span>}
                </div>
                {h.title && <div className="probe-title">{h.title}</div>}
                <div className="probe-snippet">{h.snippet}…</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- banc de test (récupération) ----------
function EvalTab() {
  const [rep, setRep] = useState<EvalReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try { setRep(await adminEval()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Échec'); }
    finally { setBusy(false); }
  };

  return (
    <div className="tab-body">
      <p className="muted small">Gate qualité : 10 questions de référence passées dans la recherche.
        « OK » = du droit remonte (proxy : le bon texte est trouvé). Rapide, sans IA — à relancer après chaque changement d'index.</p>
      <div><button className="send" onClick={run} disabled={busy}>{busy ? 'Test en cours…' : 'Lancer le banc de test'}</button></div>
      {error && <p className="warn">⚠ {error}</p>}
      {rep && (
        <>
          <div className="stat-grid">
            <StatTile label="Trouve du droit" value={`${rep.with_law} / ${rep.total}`}
              tone={rep.with_law >= 8 ? 'ok' : rep.with_law >= 5 ? 'warn' : 'ko'} />
            <StatTile label="Trouve de la jurisprudence" value={`${rep.with_juris} / ${rep.total}`} />
          </div>
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>Question de référence</th><th>Droit</th><th>Juris.</th><th>Textes remontés</th></tr></thead>
              <tbody>
                {rep.results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.question}</td>
                    <td>{r.has_law
                      ? <span className="q-status st-ok">OK</span>
                      : <span className="q-status st-partial">manque</span>}</td>
                    <td>{r.has_juris ? '✓' : '—'}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{r.laws.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- retours (satisfaction) ----------
function FeedbackTab() {
  const [data, setData] = useState<{ items: AdminFeedback[]; stats: AdminOverview['feedback'] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { adminFeedback().then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="tab-body"><p className="warn">⚠ {error}</p></div>;
  if (!data) return <div className="tab-body"><p className="muted">Chargement…</p></div>;

  return (
    <div className="tab-body">
      <div className="stat-grid">
        <StatTile label="Satisfaction"
          value={data.stats.satisfaction == null ? '—' : `${Math.round(data.stats.satisfaction * 100)} %`}
          hint={`${fmtNum(data.stats.total)} retours`} />
        <StatTile label="👍 Utiles" value={fmtNum(data.stats.helpful)} />
        <StatTile label="👎 À améliorer" value={fmtNum(data.stats.not_helpful)}
          tone={data.stats.not_helpful > 0 ? 'warn' : undefined} />
      </div>
      <p className="muted small">Retours des utilisateurs sur les réponses — le « ce qui manquait » guide l'amélioration du corpus et du prompt.</p>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>Date</th><th>Compte</th><th>Avis</th><th>Question</th><th>Ce qui manquait</th></tr></thead>
          <tbody>
            {data.items.map((f) => (
              <tr key={f.id}>
                <td className="muted nowrap">{fmtDate(f.created_at)}</td>
                <td className="mono nowrap">{f.email || 'anonyme'}</td>
                <td>{f.helpful ? '👍' : '👎'}</td>
                <td><div className="q-text">{f.question}</div></td>
                <td className="q-preview">{f.missing || '—'}</td>
              </tr>
            ))}
            {data.items.length === 0 && <tr><td colSpan={5} className="muted">Aucun retour pour l'instant.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- corpus ----------
function CorpusTab({ ov, onRefresh, refreshing }: {
  ov: AdminOverview; onRefresh: () => void; refreshing: boolean;
}) {
  const bs = ov.corpus.by_source || {};
  const sources = [
    { key: 'jurisprudence', label: 'Jurisprudence', color: 'var(--primary)' },
    { key: 'law', label: 'Textes de loi', color: 'var(--amber)' },
    { key: 'projet_loi', label: 'Projets de loi', color: 'var(--green)' },
  ];
  const totalChunks = ov.corpus.chunks || Object.values(bs).reduce((a, b) => a + b, 0) || 0;

  return (
    <div className="tab-body">
      <div className="corpus-head">
        <div>
          <div className="panel-title">Corpus indexé</div>
          <p className="muted small">
            À jour au {ov.corpus.updated || '—'} · dernière année {ov.corpus.latest_year ?? '—'}
            {ov.index.is_indexing && <span className="pill-indexing"> indexation en cours</span>}
          </p>
        </div>
        <button className="ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Actualisation…' : '↻ Actualiser'}
        </button>
      </div>

      <div className="stat-grid">
        <StatTile label="Décisions" value={fmtNum(ov.corpus.decisions)} />
        <StatTile label="Textes de loi" value={fmtNum(ov.corpus.texts)} />
        <StatTile label="Projets de loi" value={fmtNum(ov.corpus.projets)} />
        <StatTile label="Chunks (index Meili)" value={fmtNum(ov.index.documents ?? totalChunks)} />
      </div>

      <div className="panel">
        <div className="panel-title">Répartition par source</div>
        {sources.map((s) => {
          const v = bs[s.key] || 0;
          const pct = totalChunks ? Math.round((v / totalChunks) * 100) : 0;
          return (
            <div className="bar-row" key={s.key}>
              <div className="bar-label">{s.label}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${pct}%`, background: s.color }} />
              </div>
              <div className="bar-val mono">{fmtNum(v)} · {pct} %</div>
            </div>
          );
        })}
      </div>

      <p className="muted small note">
        Une réindexation complète (nouveaux ZIP jurisprudence, refresh Legilux) reste une opération
        serveur — <span className="mono">refresh_corpus.sh</span> sur le VPS — volontairement non exposée
        ici pour éviter toute action destructive depuis le web.
      </p>
    </div>
  );
}

// ---------- santé & observabilité ----------
// libellés lisibles pour les compteurs techniques renvoyés par /api/admin/health
const COUNT_LABELS: Record<string, string> = {
  users: 'Comptes',
  vault_documents: 'Documents Vault',
  audit_log: 'Entrées de journal',
  api_keys: 'Clés API',
  questions: 'Questions loguées',
  favorites: 'Favoris',
};

function HealthTab() {
  const [data, setData] = useState<AdminHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminHealth().then(setData).catch((e) =>
      setError(e instanceof Error ? e.message : 'Échec'));
  }, []);

  if (error) return <div className="tab-body"><p className="warn">⚠ {error}</p></div>;
  if (!data) return <div className="tab-body"><p className="muted">Chargement…</p></div>;

  const routing = data.llm_routing;

  return (
    <div className="tab-body">
      <div className="panel">
        <div className="panel-title">Voyants système</div>
        <div className="kv-grid">
          <div className="kv"><span>Meilisearch</span>
            <b className={data.meilisearch ? 'ok' : 'ko'}>{data.meilisearch ? 'en ligne' : 'hors ligne'}</b></div>
          <div className="kv"><span>Clé LLM</span>
            <b className={data.llm_configured ? 'ok' : 'ko'}>{data.llm_configured ? 'configurée' : 'absente'}</b></div>
          <div className="kv"><span>Index — documents</span>
            <b className="mono">{fmtNum(data.index.documents)}</b></div>
          <div className="kv"><span>Indexation en cours</span>
            <b>{data.index.is_indexing ? 'oui' : 'non'}</b></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Routage LLM par sensibilité</div>
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>Sensibilité</th><th>Fournisseur</th><th>Modèle</th></tr></thead>
            <tbody>
              <tr>
                <td>Public</td>
                <td>{routing.public.fournisseur}</td>
                <td className="mono">{routing.public.modele}</td>
              </tr>
              <tr>
                <td>Confidentiel</td>
                <td>{routing.confidentiel.fournisseur}</td>
                <td className="mono">{routing.confidentiel.modele}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Compteurs</div>
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>Objet</th><th>Total</th></tr></thead>
            <tbody>
              {Object.entries(data.counts).map(([k, v]) => (
                <tr key={k}>
                  <td>{COUNT_LABELS[k] || k}</td>
                  <td className="num">{fmtNum(v)}</td>
                </tr>
              ))}
              {Object.keys(data.counts).length === 0 &&
                <tr><td colSpan={2} className="muted">Aucun compteur.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- paramétrage runtime + rétention ----------
function ConfigTab() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [modifiables, setModifiables] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = () => {
    setError(null);
    adminGetConfig().then((d) => {
      setConfig(d.config);
      setModifiables(d.modifiables);
      const init: Record<string, string> = {};
      for (const k of d.modifiables) init[k] = d.config[k] == null ? '' : String(d.config[k]);
      setDrafts(init);
    }).catch((e) => setError(e instanceof Error ? e.message : 'Échec'));
  };
  useEffect(load, []);

  const apply = async (key: string) => {
    setBusyKey(key); setError(null); setOkMsg(null);
    try {
      await adminPatchConfig({ [key]: drafts[key] });
      setOkMsg(`« ${key} » appliqué.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec');
    } finally {
      setBusyKey(null);
    }
  };

  // ---- rétention ----
  const [days, setDays] = useState(365);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);
  const [purgeErr, setPurgeErr] = useState<string | null>(null);

  const purge = async () => {
    if (!window.confirm(
      `Purger définitivement les données de plus de ${days} jours ? Cette action est irréversible.`)) return;
    setPurgeBusy(true); setPurgeErr(null); setPurgeMsg(null);
    try {
      const r = await adminPurge(days);
      const lines = Object.entries(r.deleted).map(([k, v]) => `${k} : ${fmtNum(v)}`).join(' · ');
      setPurgeMsg(`Purge avant ${r.before} — ${lines || 'rien à supprimer'}.`);
    } catch (e) {
      setPurgeErr(e instanceof Error ? e.message : 'Échec');
    } finally {
      setPurgeBusy(false);
    }
  };

  if (error && !config) return <div className="tab-body"><p className="warn">⚠ {error}</p></div>;
  if (!config) return <div className="tab-body"><p className="muted">Chargement…</p></div>;

  return (
    <div className="tab-body">
      <div className="panel">
        <div className="panel-title">Paramétrage runtime</div>
        <p className="muted small">Réglages modifiables à chaud. Seules les clés listées comme modifiables sont éditables.</p>
        {okMsg && <p className="ok small">✓ {okMsg}</p>}
        {error && <p className="warn">⚠ {error}</p>}
        {modifiables.length === 0 && <p className="muted small">Aucun paramètre modifiable.</p>}
        {modifiables.map((k) => (
          <div className="bar-row" key={k} style={{ alignItems: 'center', gap: 8 }}>
            <div className="bar-label mono" style={{ minWidth: 220 }}>{k}</div>
            <input
              value={drafts[k] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
              disabled={busyKey === k}
              style={{ flex: 1 }}
            />
            <button className="send" onClick={() => apply(k)} disabled={busyKey === k}>
              {busyKey === k ? '…' : 'Appliquer'}
            </button>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-title">Rétention des données</div>
        <p className="muted small">Suppression des données antérieures à un seuil (jours). Opération destructive et irréversible.</p>
        <div className="probe-form">
          <input type="number" min={1} value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
            style={{ maxWidth: 140 }} />
          <button className="row-del" onClick={purge} disabled={purgeBusy}>
            {purgeBusy ? 'Purge…' : `Purger > ${days} j`}
          </button>
        </div>
        {purgeErr && <p className="warn">⚠ {purgeErr}</p>}
        {purgeMsg && <p className="ok small">✓ {purgeMsg}</p>}
      </div>
    </div>
  );
}

// ---------- journal d'audit ----------
// ---------- Tests fonctionnels : visualisation des rapports du moteur ----------
// Le moteur (functional/) joue ~450 assertions (parcours utilisateur + matrice
// endpoint × profil) contre l'app stubée, en sous-processus à base jetable.
// Cet onglet montre le DERNIER rapport, permet de relancer la suite (si embarquée
// dans l'image) et d'importer un rapport JSON produit ailleurs (poste local, CI).
function FSectionView({ titre, section, echecsSeuls }:
  { titre: string; section: FSection; echecsSeuls: boolean }) {
  const parFonc = new Map<string, FRes[]>();
  for (const r of section.resultats) {
    if (!parFonc.has(r.fonctionnalite)) parFonc.set(r.fonctionnalite, []);
    parFonc.get(r.fonctionnalite)!.push(r);
  }
  const foncs = [...parFonc.entries()]
    .filter(([, rs]) => !echecsSeuls || rs.some((r) => !r.ok));
  return (
    <section className="ftests-sec">
      <h3>{titre} <span className="muted">— {section.verts}/{section.total} assertions vertes</span></h3>
      {foncs.length === 0 && <p className="muted">Aucun échec dans cette section. ✓</p>}
      {foncs.map(([fonc, rs]) => {
        const ok = rs.every((r) => r.ok);
        const parCas = new Map<string, FRes[]>();
        for (const r of rs) {
          if (!parCas.has(r.cas)) parCas.set(r.cas, []);
          parCas.get(r.cas)!.push(r);
        }
        return (
          <details key={fonc} className={`ftests-fonc ${ok ? 'ok' : 'ko'}`} open={!ok}>
            <summary>
              <span className={`ftests-etat ${ok ? 'ok' : 'ko'}`}>{ok ? '✅' : '❌'}</span>
              {' '}{fonc}
              <span className="muted"> ({rs.filter((r) => r.ok).length}/{rs.length})</span>
            </summary>
            <ul className="ftests-cas">
              {[...parCas.entries()]
                .filter(([, cs]) => !echecsSeuls || cs.some((c) => !c.ok))
                .map(([cas, cs]) => (
                <li key={cas}>
                  <code className="ftests-casid">{cas}</code>
                  <span className="ftests-profils">
                    {cs.map((c, i) => (
                      <span key={i} className={`ftests-chip ${c.ok ? 'ok' : 'ko'}`}
                        title={c.ok ? `${c.profil} : ${c.attendu}` :
                          `${c.profil} — attendu ${c.attendu}, obtenu ${c.obtenu}. ${c.detail}`}>
                        {c.profil} {c.ok ? '✓' : `✗ ${c.obtenu}≠${c.attendu}`}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}

// ---------- Catalogue de la suite : intention / parcours / résultat attendu ----------
// Vue STATIQUE (aucune exécution) : rend lisible ce que la suite couvre — chaque
// parcours utilisateur (objectif + étapes « qui fait quoi ») et chaque cas de la
// matrice (intention + action + attente par profil).
function CatParcoursView({ p, ouvert }: { p: CatParcours; ouvert: boolean }) {
  return (
    <details className="ftests-fonc" open={ouvert}>
      <summary>
        🧭 <b>{p.objectif}</b>
        <span className="muted"> — {p.profil} · {p.etapes.length} étapes</span>
      </summary>
      <table className="admin-table ftests-cat-table">
        <thead><tr><th>#</th><th>Acteur</th><th>Étape</th><th>Action</th><th>Résultat attendu</th></tr></thead>
        <tbody>
          {p.etapes.map((e, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td>{e.acteur}</td>
              <td>{e.libelle}</td>
              <td><code className="ftests-casid">{e.action}</code></td>
              <td><span className={`ftests-chip ${e.attendu.startsWith('HTTP') ? 'refus' : e.attendu === 'refus gracieux' ? 'gracieux' : 'ok'}`}>{e.attendu}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function CatMatriceView({ fonc, cas, ouvert }: { fonc: string; cas: CatCas[]; ouvert: boolean }) {
  return (
    <details className="ftests-fonc" open={ouvert}>
      <summary><b>{fonc}</b><span className="muted"> — {cas.length} cas</span></summary>
      <table className="admin-table ftests-cat-table">
        <thead><tr><th>Intention</th><th>Action</th><th>Attendu par profil</th></tr></thead>
        <tbody>
          {cas.map((c) => (
            <tr key={c.id}>
              <td>{c.intention}</td>
              <td><code className="ftests-casid">{c.action}</code></td>
              <td>
                <span className="ftests-profils">
                  {c.attentes.map((a, i) => (
                    <span key={i}
                      className={`ftests-chip ${a.attendu.startsWith('HTTP') ? 'refus' : a.attendu === 'refus gracieux' ? 'gracieux' : 'ok'}`}>
                      {a.profil} : {a.attendu}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function CatalogueView() {
  const [cat, setCat] = useState<TestsCatalogue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    adminTestsCatalogue().then(setCat)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erreur'));
  }, []);
  if (err) return <p className="warn">⚠ {err}</p>;
  if (!cat) return <p className="muted">Chargement…</p>;
  if (!cat.disponible) {
    return <p className="muted">Le catalogue n'est pas disponible ici (paquet
      <code> functional/</code> absent de l'image).</p>;
  }

  const needle = q.trim().toLowerCase();
  const contient = (...xs: string[]) => xs.some((x) => x.toLowerCase().includes(needle));
  const parcours = !needle ? cat.parcours : cat.parcours.filter((p) =>
    contient(p.objectif, p.profil) || p.etapes.some((e) => contient(e.libelle, e.action, e.acteur)));
  const parFonc = new Map<string, CatCas[]>();
  for (const c of cat.matrice) {
    if (needle && !contient(c.fonctionnalite, c.intention, c.action, c.id)) continue;
    if (!parFonc.has(c.fonctionnalite)) parFonc.set(c.fonctionnalite, []);
    parFonc.get(c.fonctionnalite)!.push(c);
  }

  return (
    <>
      <div className="ftests-kpis">
        <div className="ftests-kpi"><b>{cat.totaux.parcours}</b><span>parcours utilisateur</span></div>
        <div className="ftests-kpi"><b>{cat.totaux.etapes}</b><span>étapes de parcours</span></div>
        <div className="ftests-kpi"><b>{cat.totaux.cas}</b><span>cas de matrice</span></div>
        <div className="ftests-kpi"><b>{cat.totaux.etapes + cat.totaux.assertions_matrice}</b><span>assertions au total</span></div>
      </div>
      <input className="ftests-cat-search" type="search" value={q}
        placeholder="Filtrer (intention, endpoint, acteur…)"
        onChange={(e) => setQ(e.target.value)} />
      <section className="ftests-sec">
        <h3>Parcours utilisateur <span className="muted">— objectif, étapes enchaînées, attendu</span></h3>
        {parcours.length === 0 && <p className="muted">Aucun parcours ne correspond au filtre.</p>}
        {parcours.map((p) => <CatParcoursView key={p.id} p={p} ouvert={!!needle} />)}
      </section>
      <section className="ftests-sec">
        <h3>Matrice endpoint × profil <span className="muted">— intention, action, attente par profil</span></h3>
        {parFonc.size === 0 && <p className="muted">Aucun cas ne correspond au filtre.</p>}
        {[...parFonc.entries()].map(([fonc, cas]) =>
          <CatMatriceView key={fonc} fonc={fonc} cas={cas} ouvert={!!needle} />)}
      </section>
    </>
  );
}

function TestsTab() {
  const [data, setData] = useState<AdminTests | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [echecsSeuls, setEchecsSeuls] = useState(false);
  const [vue, setVue] = useState<'rapport' | 'catalogue'>('rapport');
  const enCours = data?.execution.statut === 'en_cours';

  const charger = () => adminTests().then((d) => { setData(d); setErr(null); })
    .catch((e) => setErr(e instanceof Error ? e.message : 'Erreur'));
  useEffect(() => { charger(); }, []);
  // pendant un run : re-lire l'état toutes les 5 s jusqu'à la fin
  useEffect(() => {
    if (!enCours) return;
    const t = setInterval(charger, 5000);
    return () => clearInterval(t);
  }, [enCours]);

  const lancer = async () => {
    setNote(null);
    try { await adminTestsRun(); setNote('Suite lancée — ~2 min (base jetable, serveur non affecté).'); charger(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
  };

  const importer = async (f: File) => {
    setNote(null); setErr(null);
    try {
      const rapport = JSON.parse(await f.text());
      const res = await adminTestsImport(rapport);
      setNote(`Rapport importé : ${res.verts}/${res.total} assertions vertes.`);
      charger();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Rapport illisible'); }
  };

  if (err && !data) return <p className="warn">⚠ {err}</p>;
  if (!data) return <p className="muted">Chargement…</p>;
  const d = data.dernier;
  const tout_vert = d ? d.verts === d.total : false;

  return (
    <div className="ftests">
      <div className="ftests-bar">
        <div className="ftests-vues">
          <button className={vue === 'rapport' ? 'primary' : 'ghost'}
            onClick={() => setVue('rapport')}>Rapport</button>
          <button className={vue === 'catalogue' ? 'primary' : 'ghost'}
            onClick={() => setVue('catalogue')}
            title="Ce que la suite couvre : intention, parcours, résultat attendu — sans exécution">
            📖 Catalogue</button>
        </div>
        {vue === 'rapport' && <>
        <button className="primary" onClick={lancer} disabled={!data.executable || enCours}
          title={data.executable ? 'Joue la suite en sous-processus isolé (base jetable)'
            : 'Suite non embarquée dans cette image — importer un rapport JSON'}>
          {enCours ? '⏳ Suite en cours…' : '▶ Lancer les tests'}
        </button>
        <label className="ghost ftests-import">
          ⬆ Importer un rapport JSON
          <input type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importer(f); e.target.value = ''; }} />
        </label>
        <label className="ftests-toggle">
          <input type="checkbox" checked={echecsSeuls} onChange={(e) => setEchecsSeuls(e.target.checked)} />
          {' '}échecs seulement
        </label>
        </>}
      </div>
      {vue === 'catalogue' ? <CatalogueView /> : <>
      {note && <p className="muted">{note}</p>}
      {err && <p className="warn">⚠ {err}</p>}
      {data.execution.statut === 'erreur' && (
        <p className="warn">⚠ Dernier lancement en erreur : {data.execution.erreur}</p>
      )}

      {!d && (
        <div className="ftests-vide">
          <p>Aucun rapport archivé pour l'instant.</p>
          <p className="muted">Cliquez « Lancer les tests », ou produisez un rapport en local puis importez-le :</p>
          <pre className="ftests-cmd">python -m functional.run --format json &gt; rapport.json</pre>
        </div>
      )}

      {d && (
        <>
          <div className="ftests-kpis">
            <div className={`ftests-kpi ${tout_vert ? 'ok' : 'ko'}`}>
              <b>{d.verts}/{d.total}</b><span>assertions vertes</span>
            </div>
            <div className="ftests-kpi"><b>{d.total - d.verts}</b><span>échec{d.total - d.verts > 1 ? 's' : ''}</span></div>
            <div className="ftests-kpi"><b>{d.duree_s != null ? `${Math.round(d.duree_s)} s` : '—'}</b><span>durée</span></div>
            <div className="ftests-kpi">
              <b>{new Date(d.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</b>
              <span>{d.source === 'backoffice' ? 'lancé ici' : 'importé'}</span>
            </div>
          </div>

          {d.rapport.parcours && (
            <FSectionView titre="Parcours utilisateur" section={d.rapport.parcours} echecsSeuls={echecsSeuls} />
          )}
          {d.rapport.matrice && (
            <FSectionView titre="Matrice d'autorisation (endpoint × profil)" section={d.rapport.matrice} echecsSeuls={echecsSeuls} />
          )}

          {data.historique.length > 1 && (
            <section className="ftests-sec">
              <h3>Historique</h3>
              <table className="admin-table">
                <thead><tr><th>Date</th><th>Source</th><th>Score</th><th>Durée</th></tr></thead>
                <tbody>
                  {data.historique.map((h) => (
                    <tr key={h.id}>
                      <td>{new Date(h.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{h.source}</td>
                      <td className={h.verts === h.total ? 'ftests-score-ok' : 'ftests-score-ko'}>
                        {h.verts}/{h.total}</td>
                      <td>{h.duree_s != null ? `${Math.round(h.duree_s)} s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
      </>}
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');

  const load = (filter = '') => {
    setRows(null); setError(null);
    adminAudit(200, filter).then(setRows).catch((e) =>
      setError(e instanceof Error ? e.message : 'Échec'));
  };
  useEffect(() => { load(); }, []);

  const submit = (e: FormEvent) => { e.preventDefault(); load(action.trim()); };

  return (
    <div className="tab-body">
      <p className="muted small">Traçabilité des actions administratives et sensibles (200 dernières entrées).</p>
      <form className="probe-form" onSubmit={submit}>
        <input value={action} onChange={(e) => setAction(e.target.value)}
          placeholder="Filtrer par action (préfixe, ex : user.)" />
        <button className="send" type="submit">Filtrer</button>
      </form>

      {error && <p className="warn">⚠ {error}</p>}
      {!rows && !error && <p className="muted">Chargement…</p>}
      {rows && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>Date</th><th>Compte</th><th>Action</th><th>Détail</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="muted nowrap">{fmtDate(a.ts)}</td>
                  <td className="mono nowrap">{a.email || '—'}</td>
                  <td className="mono">{a.action}</td>
                  <td className="q-preview">{a.detail || '—'}</td>
                  <td className="mono muted nowrap">{a.ip || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="muted">Aucune entrée.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- app ----------
export default function AdminApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadOverview = async () => {
    try {
      const data = await adminOverview();
      setOv(data);
      setPhase('ready');
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) setPhase('login');
      else if (e instanceof HttpError && e.status === 403) setPhase('denied');
      else { setError(e instanceof Error ? e.message : 'Erreur'); setPhase('ready'); }
    }
  };

  useEffect(() => { loadOverview(); }, []);

  const refresh = async () => {
    setRefreshing(true);
    try { await loadOverview(); } finally { setRefreshing(false); }
  };

  const doLogout = async () => { await logout(); window.location.href = '/'; };

  if (phase === 'loading') return <div className="admin-gate"><p className="muted">Chargement…</p></div>;
  if (phase === 'login') return <AdminReconnect />;
  if (phase === 'denied') {
    return (
      <div className="admin-gate">
        <div className="admin-login">
          <div className="admin-brand"><span className="logo">⚖</span><strong>Jurilux</strong>
            <span className="admin-tag">Backoffice</span></div>
          <p className="warn">⚠ Ce compte n'a pas les droits administrateur.</p>
          <button className="ghost" onClick={doLogout}>Changer de compte</button>
          <p className="muted small"><a href="/">← Retour au site</a></p>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Tableau de bord' },
    { key: 'inspector', label: 'Inspecteur' },
    { key: 'eval', label: 'Banc de test' },
    { key: 'users', label: 'Utilisateurs' },
    { key: 'questions', label: 'Questions' },
    { key: 'feedback', label: 'Retours' },
    { key: 'corpus', label: 'Corpus' },
    { key: 'health', label: 'Santé' },
    { key: 'config', label: 'Paramétrage' },
    { key: 'audit', label: 'Audit' },
    { key: 'tests', label: 'Tests' },
    { key: 'docs', label: '📘 Documentation' },
  ];

  return (
    <div className="admin-app">
      <header className="admin-header">
        <div className="admin-brand"><span className="logo">⚖</span><strong>Jurilux</strong>
          <span className="admin-tag">Backoffice</span></div>
        <nav className="admin-tabs">
          {tabs.map((t) => (
            <button key={t.key} className={`admin-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </nav>
        <div className="admin-header-actions">
          <a className="ghost small-link" href="/">Voir le site</a>
          <button className="ghost" onClick={doLogout}>Déconnexion</button>
        </div>
      </header>

      <main className="admin-main">
        {error && <p className="warn">⚠ {error}</p>}
        {ov && tab === 'dashboard' && <Dashboard ov={ov} />}
        {tab === 'inspector' && <InspectorTab />}
        {tab === 'eval' && <EvalTab />}
        {tab === 'users' && <Users />}
        {tab === 'questions' && <Questions />}
        {tab === 'feedback' && <FeedbackTab />}
        {ov && tab === 'corpus' && <CorpusTab ov={ov} onRefresh={refresh} refreshing={refreshing} />}
        {tab === 'health' && <HealthTab />}
        {tab === 'config' && <ConfigTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'tests' && <TestsTab />}
        {tab === 'docs' && <Suspense fallback={<p className="muted">Chargement…</p>}><Documentation /></Suspense>}
      </main>
    </div>
  );
}
