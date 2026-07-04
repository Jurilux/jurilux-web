import { useEffect, useState, FormEvent } from 'react';
import {
  adminOverview, adminUsers, adminQuestions, adminFeedback, adminSetPlan, adminSetAdmin, adminDeleteUser,
  adminLogin, logout, getStoredEmail, HttpError,
  AdminOverview, AdminUser, AdminQuestion, AdminFeedback,
} from './api';

type Phase = 'loading' | 'login' | 'denied' | 'ready';
type Tab = 'dashboard' | 'users' | 'questions' | 'feedback' | 'corpus';

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

// ---------- login ----------
function AdminLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(getStoredEmail() || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await adminLogin(email.trim(), password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de connexion');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-gate">
      <form className="admin-login" onSubmit={submit}>
        <div className="admin-brand"><span className="logo">⚖</span><strong>Jurilux</strong>
          <span className="admin-tag">Backoffice</span></div>
        <p className="muted">Espace réservé aux administrateurs.</p>
        <label>Email
          <input type="email" required autoFocus value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.lu" />
        </label>
        <label>Mot de passe
          <input type="password" required value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </label>
        {error && <p className="warn">⚠ {error}</p>}
        <button className="send" type="submit" disabled={busy}>{busy ? '…' : 'Se connecter'}</button>
      </form>
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

  const doLogout = async () => { await logout(); setOv(null); setPhase('login'); };

  if (phase === 'loading') return <div className="admin-gate"><p className="muted">Chargement…</p></div>;
  if (phase === 'login') return <AdminLogin onDone={loadOverview} />;
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
    { key: 'users', label: 'Utilisateurs' },
    { key: 'questions', label: 'Questions' },
    { key: 'feedback', label: 'Retours' },
    { key: 'corpus', label: 'Corpus' },
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
        {tab === 'users' && <Users />}
        {tab === 'questions' && <Questions />}
        {tab === 'feedback' && <FeedbackTab />}
        {ov && tab === 'corpus' && <CorpusTab ov={ov} onRefresh={refresh} refreshing={refreshing} />}
      </main>
    </div>
  );
}
