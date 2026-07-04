// Client API Jurilux — same-origin uniquement.
// En prod, Caddy route /api/* vers le backend et /docs/* vers les PDFs.
// En dev local, le proxy Vite (vite.config.ts) fait la même chose.

export interface SearchFilters {
  year_min?: number;
  year_max?: number;
  juridiction_key?: string;
}

export interface Citation {
  doc_id: string;
  url?: string;
  pdf_url?: string;
  year?: number | null;
  juridiction_key?: string | null;
  content?: string;
  source_type?: 'jurisprudence' | 'law';
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
  prompt_version?: string;
}

const TIMEOUT_MS = 60_000;

export async function ask(
  q: string,
  topK = 20,
  filters: SearchFilters = {},
  temperature = 0,
): Promise<AskResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const cleaned: SearchFilters = {};
  if (typeof filters.year_min === 'number' && !isNaN(filters.year_min)) cleaned.year_min = filters.year_min;
  if (typeof filters.year_max === 'number' && !isNaN(filters.year_max)) cleaned.year_max = filters.year_max;
  if (filters.juridiction_key?.trim()) cleaned.juridiction_key = filters.juridiction_key.trim();

  const payload: Record<string, unknown> = { q, topK, temperature };
  if (Object.keys(cleaned).length > 0) payload.filters = cleaned;

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  if (c.source_type === 'law') {
    return c.pdf_url || null;
  }
  if (c.doc_id) return `/docs/${c.doc_id}.pdf`;
  return c.pdf_url || null;
}
