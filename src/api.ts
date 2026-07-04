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

export const adminOverview = () => adminGet<AdminOverview>('/api/admin/overview');
export const adminUsers = () => adminGet<{ items: AdminUser[] }>('/api/admin/users').then((d) => d.items);
export const adminQuestions = (limit = 100) =>
  adminGet<{ items: AdminQuestion[] }>(`/api/admin/questions?limit=${limit}`).then((d) => d.items);
export const adminFeedback = () =>
  adminGet<{ items: AdminFeedback[]; stats: AdminOverview['feedback'] }>('/api/admin/feedback');
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
