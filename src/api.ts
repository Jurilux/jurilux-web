// Client API Jurilux — same-origin uniquement.
// En prod, Caddy route /api/* vers le backend et /docs/* vers les PDFs.
// En dev local, le proxy Vite (vite.config.ts) fait la même chose.

export interface SearchFilters {
  year_min?: number;
  year_max?: number;
  juridiction_key?: string;
  source_type?: string;   // jurisprudence | law | projet_loi
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
  suggested_question?: string | null;
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

export async function ask(
  q: string,
  topK = 20,
  filters: SearchFilters = {},
  temperature = 0,
  pedagogical = false,
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
  onDelta: (text: string) => void, onMeta: (meta: AskResponse) => void,
): Promise<void> {
  const cleaned: SearchFilters = {};
  if (typeof filters.year_min === 'number' && !isNaN(filters.year_min)) cleaned.year_min = filters.year_min;
  if (typeof filters.year_max === 'number' && !isNaN(filters.year_max)) cleaned.year_max = filters.year_max;
  if (filters.juridiction_key?.trim()) cleaned.juridiction_key = filters.juridiction_key.trim();
  if (filters.source_type) cleaned.source_type = filters.source_type;
  const payload: Record<string, unknown> = { q, topK, temperature };
  if (Object.keys(cleaned).length > 0) payload.filters = cleaned;
  if (pedagogical) payload.pedagogical = true;

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
export interface Dossier { id: number; name: string; items: number; created_at?: string; }
export interface DossierItem {
  id: number; question: string; answer: string | null; citations: Citation[];
  status: string | null; created_at: string; added_by: string | null;
}

async function wsGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Erreur (HTTP ${res.status})`);
  return (await res.json()) as T;
}
async function wsSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Erreur (HTTP ${res.status})`);
  return (await res.json().catch(() => ({}))) as T;
}

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

async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { ...authHeaders() } });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new HttpError(res.status, d.detail || `Erreur (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

async function adminSend(path: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new HttpError(res.status, d.detail || `Erreur (HTTP ${res.status})`);
  }
}

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
}
export interface InsightCase {
  display_name: string; doc_id: string; year: number | null; juridiction_key: string | null;
  side?: string | null; won?: number | null;
}
export interface InsightCoCounsel { name_key: string; name: string; count: number; relation: string; }
export interface InsightProfile {
  name_key: string; name: string; cases_count: number; first_year: number | null; last_year: number | null;
  as_demandeur: number; as_defendeur: number; won: number; lost: number; decided: number;
  cocounsel: InsightCoCounsel[]; cases: InsightCase[];
}
export const insightStats = () => adminGet<{ lawyers: number; appearances: number }>('/api/insight/stats');
export const insightLawyers = (q = '', limit = 50) =>
  adminGet<{ items: InsightLawyer[] }>(
    `/api/insight/lawyers?limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((d) => d.items);
export const insightLawyer = (key: string) =>
  adminGet<InsightProfile>(`/api/insight/lawyers/${encodeURIComponent(key)}`);

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
export async function adminProbe(q: string, topK = 12): Promise<{ count: number; hits: ProbeHit[] }> {
  const res = await fetch('/api/admin/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ q, topK }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new HttpError(res.status, d.detail || `Erreur (HTTP ${res.status})`);
  }
  return (await res.json()) as { count: number; hits: ProbeHit[] };
}
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
