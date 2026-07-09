// Client API Jurilux — same-origin uniquement.
// En prod, Caddy route /api/* vers le backend et /docs/* vers les PDFs.
// En dev local, le proxy Vite (vite.config.ts) fait la même chose.

export interface SearchFilters {
  year_min?: number;
  year_max?: number;
  juridiction_key?: string;
  source_type?: string;   // jurisprudence | law | projet_loi
  country?: string;       // LU | BE | FR — multi-juridiction (optionnel)
}

export interface Citation {
  doc_id: string;
  url?: string;
  pdf_url?: string;
  year?: number | null;
  juridiction_key?: string | null;
  content?: string;
  source_type?: 'jurisprudence' | 'law' | 'projet_loi';
  title?: string;
}

export interface Feedback {
  why?: string;
  what_we_see?: string[];
  limits?: string;
  how_to_improve?: string[];
}

export interface AskResponse {
  answer: string | null;
  citations: Citation[];
  refused: boolean;
  status?: 'ok' | 'partial';
  feedback?: Feedback | null;
  suggested_question?: string | null;   // autre angle (pivot 1 clic)
  follow_ups?: string[] | null;         // parcours guidé : questions de suivi logiques ordonnées
  prompt_version?: string;
}

// Retour utilisateur 👍/👎 (+ ce qui manquait). Best-effort, ne bloque jamais l'UI.
export async function sendFeedback(question: string, helpful: boolean,
                                   missing?: string, status?: string): Promise<void> {
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ question, helpful, missing: missing || undefined, status }),
    });
  } catch { /* silencieux */ }
}

const TIMEOUT_MS = 60_000;

export interface Turn { role: string; content: string; }

export async function ask(
  q: string,
  topK = 20,
  filters: SearchFilters = {},
  temperature = 0,
  pedagogical = false,
  history: Turn[] = [],
): Promise<AskResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const cleaned: SearchFilters = {};
  if (typeof filters.year_min === 'number' && !isNaN(filters.year_min)) cleaned.year_min = filters.year_min;
  if (typeof filters.year_max === 'number' && !isNaN(filters.year_max)) cleaned.year_max = filters.year_max;
  if (filters.juridiction_key?.trim()) cleaned.juridiction_key = filters.juridiction_key.trim();

  const payload: Record<string, unknown> = { q, topK, temperature };
  if (Object.keys(cleaned).length > 0) payload.filters = cleaned;
  if (pedagogical) payload.pedagogical = true;
  if (history.length) payload.history = history;

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Le serveur a répondu HTTP ${res.status}. Réessayez dans un instant.`);
    }
    return (await res.json()) as AskResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('La requête a expiré (60 s). Le serveur ne répond pas.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Version STREAMÉE : la réponse s'affiche au fil de la génération (SSE).
// onDelta reçoit chaque morceau de texte ; onMeta reçoit la méta finale (citations, refus…).
export async function askStream(
  q: string, topK: number, filters: SearchFilters, temperature: number, pedagogical: boolean,
  onDelta: (text: string) => void, onMeta: (meta: AskResponse) => void, history: Turn[] = [],
): Promise<void> {
  const cleaned: SearchFilters = {};
  if (typeof filters.year_min === 'number' && !isNaN(filters.year_min)) cleaned.year_min = filters.year_min;
  if (typeof filters.year_max === 'number' && !isNaN(filters.year_max)) cleaned.year_max = filters.year_max;
  if (filters.juridiction_key?.trim()) cleaned.juridiction_key = filters.juridiction_key.trim();
  if (filters.source_type) cleaned.source_type = filters.source_type;
  const payload: Record<string, unknown> = { q, topK, temperature };
  if (Object.keys(cleaned).length > 0) payload.filters = cleaned;
  if (pedagogical) payload.pedagogical = true;
  if (history.length) payload.history = history;

  const res = await fetch('/api/ask/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error(`Le serveur a répondu HTTP ${res.status}.`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep).trim();
      buf = buf.slice(sep + 2);
      if (!raw.startsWith('data:')) continue;
      let ev: { type?: string; text?: string } & Partial<AskResponse>;
      try { ev = JSON.parse(raw.slice(5).trim()); } catch { continue; }
      if (ev.type === 'delta' && typeof ev.text === 'string') onDelta(ev.text);
      else if (ev.type === 'meta') onMeta(ev as AskResponse);
    }
  }
}

export async function health(): Promise<boolean> {
  try {
    const res = await fetch('/health');
    return res.ok;
  } catch {
    return false;
  }
}

// Périmètre du corpus (pour afficher « X décisions · Y textes · à jour »).
export interface Corpus {
  decisions: number | null;
  texts: number | null;
  projets: number | null;
  updated: string | null;
  chunks: number | null;
  latest_year: number | null;
  by_country?: Record<string, number> | null;  // multi-juridiction (LU/BE/FR) si présent
}

export async function corpus(): Promise<Corpus | null> {
  try {
    const res = await fetch('/api/corpus');
    if (!res.ok) return null;
    return (await res.json()) as Corpus;
  } catch {
    return null;
  }
}

// ---------- permaliens de réponses partageables ----------
export interface SharedResponse {
  question: string; answer: string | null; citations: Citation[];
  status: string | null; created_at: string;
}
export async function createShare(question: string, answer: string | null,
                                  citations: Citation[], status?: string): Promise<string> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ question, answer, citations, status }),
  });
  if (!res.ok) throw new Error(`Le partage a échoué (HTTP ${res.status}).`);
  return (await res.json()).id as string;
}
export async function getShare(id: string): Promise<SharedResponse | null> {
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as SharedResponse;
  } catch { return null; }
}

// URL PDF : toujours servie par notre propre domaine (/docs/<doc_id>.pdf).
// Fallback : pdf_url absolue fournie par le backend (textes de loi filestore).
export function pdfHref(c: Citation): string | null {
  if (c.source_type === 'projet_loi') return null;  // dossier externe (c.url), pas de PDF /docs
  if (c.source_type === 'law') {
    return c.pdf_url || null;
  }
  if (c.doc_id) return `/docs/${c.doc_id}.pdf`;
  return c.pdf_url || null;
}

// ---------- Espace utilisateur ----------
const TOKEN_KEY = 'jurilux_token';
const EMAIL_KEY = 'jurilux_email';

export interface AuthUser { email: string }
export interface HistoryItem {
  id: number; question: string; answer: string | null;
  status: string | null; created_at: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}
function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
function storeSession(token: string, email: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

async function authCall(path: string, email: string, password: string): Promise<AuthUser> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Erreur (HTTP ${res.status})`);
  storeSession(data.token, data.user.email);
  return data.user as AuthUser;
}

export function register(email: string, password: string): Promise<AuthUser> {
  return authCall('/api/auth/register', email, password);
}
export function login(email: string, password: string): Promise<AuthUser> {
  return authCall('/api/auth/login', email, password);
}
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { ...authHeaders() } });
  } finally {
    clearSession();
  }
}
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || `Erreur (HTTP ${res.status})`);
  }
}

export async function getHistory(): Promise<HistoryItem[]> {
  const res = await fetch('/api/history', { headers: { ...authHeaders() } });
  if (!res.ok) return [];
  return (await res.json()).items as HistoryItem[];
}

export interface Quota { plan?: string; limit: number | null; used: number; remaining: number | null; }
export interface Me { email: string; plan: string; is_admin: boolean; quota: Quota; }

// ---------- V3 offre cabinet : espaces, membres, dossiers partagés ----------
export interface Workspace { id: number; name: string; role: string; members: number; }
export interface Member { user_id: number; email: string; role: string; created_at: string; }
export interface Dossier { id: number; name: string; items: number; created_at?: string; restricted?: boolean; }
export interface DossierItem {
  id: number; question: string; answer: string | null; citations: Citation[];
  status: string | null; created_at: string; added_by: string | null;
}

const wsGet = <T,>(path: string) => request<T>(path);
const wsSend = <T,>(path: string, method: string, body?: unknown) => request<T>(path, method, body);

export const listWorkspaces = () => wsGet<{ items: Workspace[] }>('/api/workspaces').then((d) => d.items);
export const createWorkspace = (name: string) => wsSend<Workspace>('/api/workspaces', 'POST', { name });
export const listMembers = (wid: number) => wsGet<{ items: Member[] }>(`/api/workspaces/${wid}/members`).then((d) => d.items);
export const addMember = (wid: number, email: string, role = 'member') =>
  wsSend<Member>(`/api/workspaces/${wid}/members`, 'POST', { email, role });
export const removeMember = (wid: number, uid: number) =>
  wsSend<{ ok: boolean }>(`/api/workspaces/${wid}/members/${uid}`, 'DELETE');
export const setMemberRole = (wid: number, uid: number, role: string) =>
  wsSend<{ ok: boolean }>(`/api/workspaces/${wid}/members/${uid}/role`, 'POST', { role });
export const deleteWorkspace = (wid: number) =>
  wsSend<{ ok: boolean }>(`/api/workspaces/${wid}`, 'DELETE');
export const leaveWorkspace = (wid: number) =>
  wsSend<{ ok: boolean }>(`/api/workspaces/${wid}/leave`, 'POST');
export const deleteDossier = (did: number) =>
  wsSend<{ ok: boolean }>(`/api/dossiers/${did}`, 'DELETE');
export const listDossiers = (wid: number) => wsGet<{ items: Dossier[] }>(`/api/workspaces/${wid}/dossiers`).then((d) => d.items);
export const createDossier = (wid: number, name: string) =>
  wsSend<Dossier>(`/api/workspaces/${wid}/dossiers`, 'POST', { name });
export const listDossierItems = (did: number) => wsGet<{ items: DossierItem[] }>(`/api/dossiers/${did}/items`).then((d) => d.items);
export const addDossierItem = (did: number, question: string, answer: string | null,
                               citations: Citation[], status?: string) =>
  wsSend<{ id: number }>(`/api/dossiers/${did}/items`, 'POST', { question, answer, citations, status });

// ---------- V3 alertes de veille ----------
export interface Alert { id: number; query: string; source_type: string | null; unseen: number; total: number; }
export interface AlertHit {
  id: number; doc_id: string; source_type: string | null; title: string | null;
  year: number | null; juridiction_key: string | null; url: string | null; pdf_url: string | null; seen: number;
}
export const listAlerts = () => wsGet<{ items: Alert[] }>('/api/alerts').then((d) => d.items);
export const createAlert = (query: string, source_type?: string) =>
  wsSend<Alert>('/api/alerts', 'POST', { query, source_type });
export const checkAlert = (id: number) => wsSend<{ new: number }>(`/api/alerts/${id}/check`, 'POST');
export const checkAllAlerts = () => wsSend<{ new: number }>('/api/alerts/check-all', 'POST');
export const alertHits = (id: number) => wsGet<{ items: AlertHit[] }>(`/api/alerts/${id}/hits`).then((d) => d.items);
export const deleteAlert = (id: number) => wsSend<{ ok: boolean }>(`/api/alerts/${id}`, 'DELETE');

export async function me(): Promise<Me | null> {
  try {
    const res = await fetch('/api/me', { headers: { ...authHeaders() } });
    if (!res.ok) return null;
    const d = await res.json();
    return { email: d.user.email, plan: d.user.plan, is_admin: !!d.user.is_admin, quota: d.quota };
  } catch {
    return null;
  }
}

// ---------- Backoffice admin ----------
// HttpError porte le code : le front distingue 401 (se connecter) de 403 (pas admin).
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// Cœur commun des appels JSON authentifiés (Bearer) : en-têtes, corps, erreurs typées
// HttpError. Les wrappers historiques (wsGet/wsSend/adminGet/adminSend) sont des alias —
// même signature, même comportement, un seul endroit pour la gestion d'erreur.
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new HttpError(res.status, d.detail || `Erreur (HTTP ${res.status})`);
  }
  return (await res.json().catch(() => ({}))) as T;
}

const adminGet = <T,>(path: string) => request<T>(path);
const adminSend = (path: string, method: string, body?: unknown) => request<void>(path, method, body);

export interface AdminOverview {
  metrics: {
    uptime_s: number; ask_total: number; ask_refused: number; ask_errors: number;
    ask_rate_limited: number; refusal_rate: number | null;
    ask_latency_ms_avg: number | null; last_ask_ago_s: number | null;
    search_ms_avg: number | null; llm_ms_avg: number | null;
  };
  corpus: Corpus & { by_source?: Record<string, number> | null };
  index: { documents: number | null; is_indexing: boolean | null };
  health: { meilisearch: boolean; llm_configured: boolean };
  users: { total: number; students: number; pros: number; admins: number };
  questions: { total: number; last_24h: number; partial: number };
  feedback: { total: number; helpful: number; not_helpful: number; satisfaction: number | null };
  prompt_version: string;
  model: string;
  hybrid_semantic_ratio: number;
}

export interface AdminFeedback {
  id: number; email: string | null; question: string; helpful: boolean;
  missing: string | null; status: string | null; created_at: string;
}

export interface AdminUser {
  id: number; email: string; plan: string; is_admin: boolean;
  created_at: string; questions: number;
}

export interface AdminQuestion {
  id: number; email: string; question: string;
  status: string | null; answer_preview: string | null; created_at: string;
}

// Insight — profiling avocats (gate admin)
export interface InsightLawyer {
  name_key: string; name: string; cases: number; first_year: number | null; last_year: number | null;
  won?: number; decided?: number;   // renvoyés par list_lawyers (taux estimé par avocat)
}
export interface InsightCase {
  display_name: string; doc_id: string; year: number | null; juridiction_key: string | null;
  side?: string | null; won?: number | null; matter?: string | null;
}
export interface InsightCoCounsel { name_key: string; name: string; count: number; relation: string; }
export interface InsightMatter { name: string; count: number; }
export interface InsightProfile {
  name_key: string; name: string; cases_count: number; first_year: number | null; last_year: number | null;
  as_demandeur: number; as_defendeur: number; won: number; lost: number; decided: number;
  amount_median?: number | null; amount_n?: number; firm?: string | null;
  matters: InsightMatter[]; cocounsel: InsightCoCounsel[]; cases: InsightCase[];
}
export const insightStats = () => adminGet<{ lawyers: number; appearances: number }>('/api/insight/stats');
export const insightMatters = () => adminGet<{ items: InsightMatter[] }>('/api/insight/matters').then((d) => d.items);
export const insightLawyers = (q = '', limit = 50, sort = 'cases', matter = '') =>
  adminGet<{ items: InsightLawyer[] }>(
    `/api/insight/lawyers?limit=${limit}&sort=${sort}`
    + `${q ? `&q=${encodeURIComponent(q)}` : ''}${matter ? `&matter=${encodeURIComponent(matter)}` : ''}`
  ).then((d) => d.items);
export const insightLawyer = (key: string) =>
  adminGet<InsightProfile>(`/api/insight/lawyers/${encodeURIComponent(key)}`);

// ---------- Backoffice : visualisation des tests fonctionnels ----------
export interface FRes {
  fonctionnalite: string; cas: string; profil: string;
  attendu: string; obtenu: string; ok: boolean; detail: string;
}
export interface FSection {
  total: number; verts: number; code_sortie: number;
  fonctionnalites: Record<string, { reussie: boolean; ok: number; total: number }>;
  resultats: FRes[];
}
export interface FRun {
  id: number; created_at: string; source: string; total: number; verts: number;
  duree_s: number | null; rapport: { parcours?: FSection; matrice?: FSection };
}
export interface FRunSummary { id: number; created_at: string; source: string; total: number; verts: number; duree_s: number | null; }
export interface AdminTests {
  dernier: FRun | null; historique: FRunSummary[];
  execution: { statut: string; demarre_a: string | null; erreur: string | null };
  executable: boolean;
}
export const adminTests = () => adminGet<AdminTests>('/api/admin/tests');
export const adminTestsRun = () => request<void>('/api/admin/tests/run', 'POST');
export const adminTestsImport = (rapport: unknown) =>
  request<{ total: number; verts: number }>('/api/admin/tests/rapport', 'POST', rapport);

export const adminOverview = () => adminGet<AdminOverview>('/api/admin/overview');
export const adminUsers = () => adminGet<{ items: AdminUser[] }>('/api/admin/users').then((d) => d.items);
export const adminQuestions = (limit = 100) =>
  adminGet<{ items: AdminQuestion[] }>(`/api/admin/questions?limit=${limit}`).then((d) => d.items);
export const adminFeedback = () =>
  adminGet<{ items: AdminFeedback[]; stats: AdminOverview['feedback'] }>('/api/admin/feedback');

export interface EvalResult { question: string; count: number; has_law: boolean; has_juris: boolean; laws: string[]; }
export interface EvalReport { total: number; with_law: number; with_juris: number; results: EvalResult[]; }
export const adminEval = () => adminGet<EvalReport>('/api/admin/eval');

export interface ActivityDay { date: string; count: number; }
export const adminActivity = () =>
  adminGet<{ per_day: ActivityDay[] }>('/api/admin/activity').then((d) => d.per_day);

export interface ProbeHit {
  chunk_id: string; doc_id: string; source_type: string | null;
  title: string | null; year: number | null; juridiction_key: string | null; snippet: string;
}
export const adminProbe = (q: string, topK = 12) =>
  request<{ count: number; hits: ProbeHit[] }>('/api/admin/probe', 'POST', { q, topK });
export const adminSetPlan = (id: number, plan: string) =>
  adminSend(`/api/admin/users/${id}/plan`, 'POST', { plan });
export const adminSetAdmin = (id: number, is_admin: boolean) =>
  adminSend(`/api/admin/users/${id}/admin`, 'POST', { is_admin });
export const adminDeleteUser = (id: number) =>
  adminSend(`/api/admin/users/${id}`, 'DELETE');

// Connexion depuis le backoffice (réutilise le flux comptes ; ne stocke pas d'email si échec).
export async function adminLogin(email: string, password: string): Promise<void> {
  await login(email, password);
}

// ============================================================================
//  Nouvelles capacités backend (Vault, souveraineté, socle on-prem, concurrence)
// ============================================================================

// Variante de adminSend qui renvoie le corps JSON (purge, config…).
async function adminSendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new HttpError(res.status, d.detail || `Erreur (HTTP ${res.status})`);
  }
  return (await res.json().catch(() => ({}))) as T;
}

// ---------- Vault : documents privés du cabinet ----------
export interface VaultDoc {
  id: number; filename: string; mime: string | null;
  status: 'indexing' | 'ready' | 'error'; n_chunks: number; created_at: string;
}
export const listVaultDocs = () =>
  wsGet<{ items: VaultDoc[] }>('/api/vault/documents').then((d) => d.items);
export const deleteVaultDoc = (id: number) =>
  wsSend<{ ok: boolean }>(`/api/vault/documents/${id}`, 'DELETE');

// Dépôt : corps brut + nom via query. Accepte un File (drag&drop) ou du texte.
export async function vaultUpload(file: File | Blob, filename: string): Promise<VaultDoc> {
  const res = await fetch(`/api/vault/documents?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': (file as File).type || 'application/octet-stream', ...authHeaders() },
    body: file,
  });
  if (!res.ok) throw new HttpError(res.status, `Le dépôt a échoué (HTTP ${res.status}).`);
  return (await res.json()) as VaultDoc;
}

// Q&A sur le Vault (isolé) ; include_corpus = hybride privé + corpus public officiel.
export const vaultAsk = (q: string, opts: { doc_ids?: number[]; topK?: number; include_corpus?: boolean } = {}) =>
  wsSend<AskResponse>('/api/vault/ask', 'POST', { q, ...opts });

// Analyses d'un document déposé.
export interface CitationCheck { ref: string; verified: boolean; doc_id: string | null; source_type: string | null; }
export interface VaultStructure {
  lawyers: { name: string; side: string | null }[];
  matter: string | null; outcome: string | null; amounts: string[]; references: string[];
}
export interface TimelineEvent { date: string; contexte: string; }
const vaultAnalyze = <T>(id: number, task: string) =>
  wsSend<T>(`/api/vault/documents/${id}/analyze`, 'POST', { task });
export const vaultCitations = (id: number) =>
  vaultAnalyze<{ task: string; references: CitationCheck[]; verified: number; total: number }>(id, 'citations');
export const vaultExtract = (id: number) => vaultAnalyze<{ task: string } & VaultStructure>(id, 'extract');
export const vaultSummary = (id: number) => vaultAnalyze<{ task: string; summary: string }>(id, 'summary');
export const vaultCounter = (id: number) =>
  vaultAnalyze<{ task: string; answer: string | null; refused: boolean; citations: Citation[] }>(id, 'counter');
export const vaultTimeline = (id: number) => vaultAnalyze<{ task: string; events: TimelineEvent[] }>(id, 'timeline');

// Revue tabulaire : 1 document = 1 ligne, colonnes extraites.
export interface VaultReviewRow extends VaultStructure { doc_id: number; filename: string; }
export const vaultReview = (docIds: number[]) =>
  wsSend<{ columns: string[]; rows: VaultReviewRow[] }>('/api/vault/review', 'POST', { doc_ids: docIds });

// ---------- Rédaction assistée sourcée (draft) ----------
export const draft = (instruction: string, topK = 12, filters: SearchFilters = {}) =>
  wsSend<{ answer: string | null; refused: boolean; citations: Citation[] }>(
    '/api/draft', 'POST', { instruction, topK, filters });

// ---------- Analytics contentieux (public) ----------
export interface AnalyticsRow { cle: string | number; cases: number; decided: number; won: number; win_rate: number | null;
  amount_median?: number | null; amount_n?: number; delai_median?: number | null; delai_n?: number; }
export interface Analytics {
  overall: { cases: number; decided: number; won: number; win_rate: number | null; lawyers: number;
    amount_median?: number | null; amount_n?: number; delai_median?: number | null; delai_n?: number };
  by_matter: AnalyticsRow[]; by_juridiction: AnalyticsRow[]; by_year: AnalyticsRow[];
}
// ---------- Insight : cabinets, articles, droits RGPD, export (fusion du produit insight) ----------
export interface InsightFirm { firm: string; cases: number; lawyers: number; won: number; decided: number; win_rate: number | null; }
export interface InsightFirmProfile {
  firm: string; cases_count: number; lawyers_count: number; won: number; lost: number; decided: number;
  win_rate: number | null; amount_median: number | null; amount_n: number;
  first_year: number | null; last_year: number | null;
  matters: InsightMatter[]; lawyers: { name_key: string; name: string; cases: number }[];
}
export const insightFirms = (q = '', limit = 50) =>
  adminGet<{ items: InsightFirm[] }>(`/api/insight/firms?limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
    .then((d) => d.items);
export const insightFirm = (name: string) =>
  adminGet<InsightFirmProfile>(`/api/insight/firms/${encodeURIComponent(name)}`);
export interface InsightArticle { article: string; decisions: number; }
export const insightArticles = (limit = 15) =>
  adminGet<{ items: InsightArticle[] }>(`/api/insight/articles?limit=${limit}`).then((d) => d.items);
export const insightRgpdRequest = (name: string, kind: string, email?: string, message?: string) =>
  request<void>('/api/insight/rgpd-request', 'POST', { name, kind, email: email || null, message: message || null });
// ---------- Rédaction v2 : modèles, brouillons persistants, versions, raffinement ----------
export interface VariableModele { cle: string; libelle: string; exemple?: string; }
export interface ModeleIntegre {
  slug: string; name: string; kind: string; description: string;
  variables: VariableModele[]; body: string;
}
export interface ModeleUtilisateur {
  id: number; name: string; kind: string | null; body: string;
  variables: VariableModele[]; workspace_id: number | null; scope: 'perso' | 'cabinet';
}
export interface VersionBrouillon {
  id: number; motif: string | null; created_at: string; content: string; citations: Citation[];
}
export interface Brouillon {
  id: number; title: string; modele: string | null; variables: Record<string, string>;
  content: string; citations: Citation[]; created_at: string; updated_at: string;
  versions: VersionBrouillon[];
}
export interface BrouillonResume {
  id: number; title: string; modele: string | null;
  created_at: string; updated_at: string; versions: number;
}
export interface GenererPayload {
  instruction: string; title?: string; modele?: string; template_id?: number;
  variables?: Record<string, string>; ton?: string; longueur?: string;
}
export const redactionModeles = () =>
  request<{ integres: ModeleIntegre[]; modeles: ModeleUtilisateur[] }>('/api/redaction/modeles');
export const redactionCreerModele = (name: string, body: string, kind?: string,
                                     variables?: VariableModele[], workspace_id?: number) =>
  request<ModeleUtilisateur>('/api/redaction/modeles', 'POST', { name, body, kind, variables, workspace_id });
export const redactionSupprimerModele = (id: number) =>
  request<void>(`/api/redaction/modeles/${id}`, 'DELETE');
export const redactionBrouillons = () =>
  request<{ items: BrouillonResume[] }>('/api/redaction/brouillons').then((d) => d.items);
export const redactionBrouillon = (id: number) =>
  request<Brouillon>(`/api/redaction/brouillons/${id}`);
export const redactionGenerer = (p: GenererPayload) =>
  request<{ refused: boolean; answer?: string; draft?: Brouillon }>('/api/redaction/brouillons', 'POST', p);
export const redactionPatch = (id: number, patch: { title?: string; content?: string }) =>
  request<Brouillon>(`/api/redaction/brouillons/${id}`, 'PATCH', patch);
export const redactionRaffiner = (id: number, instruction: string) =>
  request<{ refused: boolean; draft: Brouillon }>(`/api/redaction/brouillons/${id}/raffiner`, 'POST', { instruction });
export const redactionSupprimer = (id: number) =>
  request<void>(`/api/redaction/brouillons/${id}`, 'DELETE');

// ---------- identité visuelle du cabinet (papier à en-tête de la rédaction) ----------
export interface Branding { cabinet: string | null; logo: string | null; signature: string | null; }
export const getBranding = () => request<Branding>('/api/branding');
/** Mise à jour partielle : champ absent = inchangé, chaîne vide = effacé. */
export const putBranding = (b: Partial<Record<keyof Branding, string>>) =>
  request<Branding>('/api/branding', 'PUT', b);

export const insightExportUrl = (q = '', sort = 'cases', matter = '', limit = 200) =>
  '/api/insight/export/lawyers.csv?limit=' + limit + '&sort=' + sort
  + (q ? `&q=${encodeURIComponent(q)}` : '') + (matter ? `&matter=${encodeURIComponent(matter)}` : '');

export const insightAnalytics = (matter = '', juridiction = '') =>
  adminGet<Analytics>('/api/insight/analytics'
    + `${matter ? `?matter=${encodeURIComponent(matter)}` : ''}`
    + `${juridiction ? `${matter ? '&' : '?'}juridiction=${encodeURIComponent(juridiction)}` : ''}`);

// ---------- Bibliothèque de prompts ----------
export interface Prompt { id: number; title: string; body: string; workspace_id: number | null; scope: 'perso' | 'cabinet'; created_at?: string; }
export const listPrompts = () => wsGet<{ items: Prompt[] }>('/api/prompts').then((d) => d.items);
export const createPrompt = (title: string, body: string, workspace_id?: number) =>
  wsSend<Prompt>('/api/prompts', 'POST', { title, body, workspace_id });
export const deletePrompt = (id: number) => wsSend<{ ok: boolean }>(`/api/prompts/${id}`, 'DELETE');

// ---------- Clés d'API de service ----------
export interface ApiKey { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked: boolean; }
export interface ApiKeyCreated { id: number; name: string; prefix: string; key: string; }
export const listApiKeys = () => wsGet<{ items: ApiKey[] }>('/api/keys').then((d) => d.items);
export const createApiKey = (name: string) => wsSend<ApiKeyCreated>('/api/keys', 'POST', { name });
export const revokeApiKey = (id: number) => wsSend<{ ok: boolean }>(`/api/keys/${id}`, 'DELETE');

// ---------- Export RGPD (portabilité) ----------
export const exportMyData = () => wsGet<Record<string, unknown>>('/api/me/export');

// ---------- Cloisons déontologiques (dossiers restreints) ----------
export const restrictDossier = (did: number, restricted: boolean) =>
  wsSend<{ ok: boolean; restricted: boolean }>(`/api/dossiers/${did}/restrict`, 'POST', { restricted });
export const grantDossierAccess = (did: number, email: string) =>
  wsSend<{ ok: boolean; user_id: number }>(`/api/dossiers/${did}/access`, 'POST', { email });
export const revokeDossierAccess = (did: number, uid: number) =>
  wsSend<{ ok: boolean }>(`/api/dossiers/${did}/access/${uid}`, 'DELETE');

// ---------- Backoffice : routage LLM, santé détaillée, config runtime, audit, purge ----------
export interface LlmRouting {
  public: { fournisseur: string; modele: string };
  confidentiel: { fournisseur: string; modele: string };
}
export const adminLlm = () => adminGet<LlmRouting>('/api/admin/llm');

export interface AdminHealth {
  meilisearch: boolean; llm_configured: boolean; llm_routing: LlmRouting;
  index: { documents: number | null; is_indexing: boolean | null };
  counts: Record<string, number>; metrics: AdminOverview['metrics'];
}
export const adminHealth = () => adminGet<AdminHealth>('/api/admin/health');

export const adminGetConfig = () =>
  adminGet<{ config: Record<string, unknown>; modifiables: string[] }>('/api/admin/config');
export const adminPatchConfig = (values: Record<string, unknown>) =>
  adminSendJson<{ applied: Record<string, unknown> }>('/api/admin/config', 'PATCH', { values });

export interface AuditEntry { id: number; ts: string; user_id: number | null; email: string | null; action: string; detail: string | null; ip: string | null; }
export const adminAudit = (limit = 200, action = '') =>
  adminGet<{ items: AuditEntry[] }>(`/api/admin/audit?limit=${limit}${action ? `&action=${encodeURIComponent(action)}` : ''}`).then((d) => d.items);
export const adminPurge = (days: number) =>
  adminSendJson<{ before: string; deleted: Record<string, number> }>('/api/admin/purge', 'POST', { days });

// ---------- Revue de contrats + playbooks (B9) ----------
export interface PlaybookRule { label: string; instruction: string; }
export interface Playbook { id: number; name: string; workspace_id: number | null; scope: 'perso' | 'cabinet'; rules: PlaybookRule[]; created_at?: string; }
export const listPlaybooks = () => wsGet<{ items: Playbook[] }>('/api/playbooks').then((d) => d.items);
export const createPlaybook = (name: string, rules: PlaybookRule[], workspace_id?: number) =>
  wsSend<Playbook>('/api/playbooks', 'POST', { name, rules, workspace_id });
export const deletePlaybook = (id: number) => wsSend<{ ok: boolean }>(`/api/playbooks/${id}`, 'DELETE');

export interface ContractFinding { label: string; status: 'ok' | 'issue' | 'missing'; note: string; }
export interface ContractReview {
  task: string; playbook: string; findings: ContractFinding[];
  summary: { total: number; ok: number; issue: number; missing: number };
}
export const reviewContract = (docId: number, playbookId: number) =>
  wsSend<ContractReview>(`/api/vault/documents/${docId}/review-contract`, 'POST', { playbook_id: playbookId });

// ---------- SSO entreprise (OIDC) ----------
// Le front n'affiche le bouton « Se connecter via le SSO du cabinet » que si activé.
export const oidcEnabled = async (): Promise<boolean> => {
  try { return (await (await fetch('/api/auth/oidc/enabled')).json()).enabled === true; }
  catch { return false; }
};
// Démarre le flux : redirige le navigateur vers l'IdP (qui reviendra sur le callback backend).
export const oidcLogin = (): void => { window.location.href = '/api/auth/oidc/login'; };
// Au retour, le backend place le jeton en fragment (#token=...) : à capter côté app au boot.
export function captureOidcToken(): string | null {
  const m = window.location.hash.match(/[#&]token=([^&]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  localStorage.setItem(TOKEN_KEY, token);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}
