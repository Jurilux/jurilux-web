import { useEffect, useRef, useState, FormEvent } from 'react';
import { ask, health, corpus, pdfHref, login, register, logout, getHistory,
  getStoredEmail, Citation, Corpus, Feedback, HistoryItem, SearchFilters } from './api';
import { juridictionLabel, lawTitle } from './juridictions';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  refused?: boolean;
  status?: 'ok' | 'partial';
  feedback?: Feedback | null;
  error?: string;
}

const PRESETS = [
  "Quelles sont les conditions de résiliation d'un bail d'habitation au Luxembourg ?",
  'Dans quels cas un licenciement avec effet immédiat est-il justifié selon la jurisprudence ?',
  'Une absence injustifiée peut-elle constituer une faute grave ?',
  'Quelle valeur probante les tribunaux reconnaissent-ils aux échanges d’emails ?',
];

function citationLabel(c: Citation): string {
  return c.source_type === 'law' ? lawTitle(c.title || c.doc_id) : juridictionLabel(c.juridiction_key);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard indisponible */ }
      }}
    >
      {copied ? '✓ Copié' : 'Copier'}
    </button>
  );
}

function CitationRow({ c, index }: { c: Citation; index: number }) {
  const [open, setOpen] = useState(false);
  const href = pdfHref(c);
  const isLaw = c.source_type === 'law';
  const excerpt = c.content ? c.content.replace(/\s+/g, ' ').trim().slice(0, 220) : null;

  return (
    <div className="citation">
      <div className="citation-head" onClick={() => setOpen(!open)}>
        <span className="ref">[{index + 1}]</span>
        <span className={`badge ${isLaw ? 'badge-law' : 'badge-juris'}`}>{isLaw ? 'Loi' : 'Jurisprudence'}</span>
        <span className="citation-title">{citationLabel(c)}</span>
        {c.year ? <span className="year">{c.year}</span> : null}
      </div>
      {open && excerpt && <p className="excerpt">« {excerpt}… »</p>}
      <div className="citation-actions">
        {href && (
          <>
            <a href={href} target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a>
            <a href={href} download>Télécharger</a>
          </>
        )}
        {!href && <span className="muted">Document indisponible</span>}
      </div>
    </div>
  );
}

function AssistantMessage({ m, onSuggestion }: { m: Message; onSuggestion: (s: string) => void }) {
  if (m.error) {
    return (
      <div className="bubble assistant">
        <div className="bubble-tag">Jurilux</div>
        <p className="warn">⚠ {m.error}</p>
      </div>
    );
  }
  if (m.refused) {
    return (
      <div className="bubble assistant">
        <div className="bubble-tag">Jurilux</div>
        <p className="warn">
          <strong>Réponse non disponible.</strong> Les sources trouvées ne permettent pas de répondre avec
          certitude. Reformulez en vous appuyant sur les décisions (ex. « Selon la jurisprudence citée… »).
        </p>
        {m.citations && m.citations.length > 0 && <Sources citations={m.citations} />}
      </div>
    );
  }
  return (
    <div className="bubble assistant">
      <div className="bubble-head">
        <div className="bubble-tag">
          Jurilux {m.status === 'partial' && <span className="badge badge-partial">Réponse partielle</span>}
        </div>
        {m.content && <CopyButton text={m.content} />}
      </div>
      <p className="answer">{m.content}</p>

      {m.status === 'partial' && m.feedback && (
        <div className="feedback">
          {m.feedback.why && <p><strong>Pourquoi :</strong> {m.feedback.why}</p>}
          {m.feedback.limits && <p className="muted">{m.feedback.limits}</p>}
          {m.feedback.how_to_improve && m.feedback.how_to_improve.length > 0 && (
            <div className="suggestions">
              {m.feedback.how_to_improve.map((s, i) => (
                <button key={i} onClick={() => onSuggestion(s)}>{s}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {m.citations && m.citations.length > 0 && <Sources citations={m.citations} />}
    </div>
  );
}

function Sources({ citations }: { citations: Citation[] }) {
  const juris = citations.filter((c) => c.source_type !== 'law');
  const laws = citations.filter((c) => c.source_type === 'law');
  return (
    <div className="sources">
      <p className="sources-title">Sources ({citations.length})</p>
      {[...juris, ...laws].map((c, i) => (
        <CitationRow key={`${c.doc_id}-${i}`} c={c} index={citations.indexOf(c)} />
      ))}
    </div>
  );
}

// Version du build, injectée par la CI (VITE_APP_VERSION = git describe). 'dev' en local.
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

function AuthModal({ onClose, onAuth }: { onClose: () => void; onAuth: (email: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fn = mode === 'login' ? login : register;
      const u = await fn(email.trim(), password);
      onAuth(u.email);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{mode === 'login' ? 'Connexion' : 'Créer un compte'}</h2>
          <button className="ghost close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Email
            <input type="email" required autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.lu" />
          </label>
          <label>Mot de passe
            <input type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="8 caractères minimum" />
          </label>
          {error && <p className="warn">⚠ {error}</p>}
          <button className="send" type="submit" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
          </button>
        </form>
        <p className="muted switch">
          {mode === 'login' ? "Pas encore de compte ? " : 'Déjà un compte ? '}
          <button className="linklike" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
            {mode === 'login' ? "S'inscrire" : 'Se connecter'}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [corpusInfo, setCorpusInfo] = useState<Corpus | null>(null);
  const [user, setUser] = useState<string | null>(getStoredEmail());
  const [authOpen, setAuthOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const openHistory = async () => { setHistOpen(true); setHistory(await getHistory()); };
  const doLogout = async () => { await logout(); setUser(null); setHistOpen(false); };
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { health().then(setConnected); }, []);
  useEffect(() => { corpus().then(setCorpusInfo); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const activeFilters =
    (typeof filters.year_min === 'number' ? 1 : 0) +
    (typeof filters.year_max === 'number' ? 1 : 0) +
    (filters.juridiction_key?.trim() ? 1 : 0);

  async function submit(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const res = await ask(question, 20, filters, 0);
      // Dédup : doc_id pour la jurisprudence, titre parsé pour les lois.
      const seen = new Set<string>();
      const citations = (res.citations || []).filter((c) => {
        const key = c.source_type === 'law' ? `law:${lawTitle(c.title || c.doc_id)}` : c.doc_id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setMessages((prev) => [...prev, {
        id: `a${Date.now()}`,
        role: 'assistant',
        content: res.answer || '',
        citations,
        refused: res.refused,
        status: res.status,
        feedback: res.feedback,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: `e${Date.now()}`,
        role: 'assistant',
        content: '',
        error: err instanceof Error ? err.message : String(err),
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">⚖</span>
          <strong>Jurilux</strong>
          <span className={`dot ${connected === null ? 'dot-wait' : connected ? 'dot-ok' : 'dot-ko'}`} />
          <span className="muted">{connected === null ? 'Vérification…' : connected ? 'Connecté' : 'Indisponible'}</span>
        </div>
        <div className="header-actions">
          <button className="ghost" onClick={() => { setMessages([]); setInput(''); }}>Nouvelle discussion</button>
          {user ? (
            <>
              <button className="ghost" onClick={openHistory}>Historique</button>
              <span className="account-email" title={user}>{user}</span>
              <button className="ghost" onClick={doLogout}>Déconnexion</button>
            </>
          ) : (
            <button className="send account-btn" onClick={() => setAuthOpen(true)}>Se connecter</button>
          )}
        </div>
      </header>

      <main>
        {messages.length === 0 ? (
          <div className="welcome">
            <h1>Assistant juridique Jurilux</h1>
            <p className="muted">
              Posez vos questions en langage naturel. Les réponses sont fondées sur la jurisprudence et la
              législation luxembourgeoises, avec sources vérifiables.
            </p>
            {corpusInfo && corpusInfo.decisions != null && (
              <p className="corpus-scope">
                Corpus : <b>{corpusInfo.decisions.toLocaleString('fr-FR')}</b> décisions
                {corpusInfo.texts != null && <> · <b>{corpusInfo.texts.toLocaleString('fr-FR')}</b> textes de loi</>}
                {corpusInfo.projets != null && <> · <b>{corpusInfo.projets.toLocaleString('fr-FR')}</b> projets de loi</>}
                {corpusInfo.updated && <> · à jour au {corpusInfo.updated.split('-').reverse().join('/')}</>}
              </p>
            )}
            <div className="presets">
              {PRESETS.map((p, i) => (
                <button key={i} onClick={() => submit(p)} disabled={loading}>{p}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="thread">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="bubble user"><p>{m.content}</p></div>
              ) : (
                <AssistantMessage key={m.id} m={m} onSuggestion={(s) => { setInput(s); inputRef.current?.focus(); }} />
              ),
            )}
            {loading && <div className="bubble assistant"><div className="bubble-tag">Jurilux</div><p className="typing">Recherche dans les sources…</p></div>}
            <div ref={endRef} />
          </div>
        )}
      </main>

      <footer>
        {showFilters && (
          <div className="filters">
            <label>
              Année min
              <input type="number" min={1900} max={2100} value={filters.year_min ?? ''}
                onChange={(e) => setFilters({ ...filters, year_min: e.target.value ? Number(e.target.value) : undefined })} />
            </label>
            <label>
              Année max
              <input type="number" min={1900} max={2100} value={filters.year_max ?? ''}
                onChange={(e) => setFilters({ ...filters, year_max: e.target.value ? Number(e.target.value) : undefined })} />
            </label>
            <label>
              Juridiction
              <input type="text" placeholder="ex : csj_ch04" value={filters.juridiction_key ?? ''}
                onChange={(e) => setFilters({ ...filters, juridiction_key: e.target.value || undefined })} />
            </label>
            {activeFilters > 0 && <button className="ghost" onClick={() => setFilters({})}>Effacer</button>}
          </div>
        )}
        <div className="input-row">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder="Posez votre question juridique…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }}
          />
          <button
            className={`ghost filter-toggle ${activeFilters > 0 ? 'active' : ''}`}
            title="Filtres (année, juridiction)"
            onClick={() => setShowFilters(!showFilters)}
          >
            ⚙{activeFilters > 0 ? ` ${activeFilters}` : ''}
          </button>
          <button className="send" disabled={!input.trim() || loading} onClick={() => submit(input)}>Envoyer</button>
        </div>
        <p className="hint muted">Shift+Enter : nouvelle ligne — les réponses ne constituent pas un avis juridique.<span className="version" title="Version du build">{APP_VERSION}</span></p>
        <p className="attribution muted">
          Sources : jurisprudence publiée par la Justice via{' '}
          <a href="https://data.public.lu/fr/organizations/administration-judiciaire/" target="_blank" rel="noopener noreferrer">data.public.lu</a>
          {' '}et textes{' '}
          <a href="https://legilux.public.lu" target="_blank" rel="noopener noreferrer">Legilux</a>
          {' '}— licence ouverte, décisions pseudonymisées et reproduites sans modification.
        </p>
      </footer>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuth={setUser} />}

      {histOpen && (
        <div className="drawer-overlay" onClick={() => setHistOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>Mon historique</h2>
              <button className="ghost close" onClick={() => setHistOpen(false)} aria-label="Fermer">✕</button>
            </div>
            {history.length === 0 ? (
              <p className="muted">Aucune question enregistrée pour l'instant.</p>
            ) : (
              <ul className="hist-list">
                {history.map((h) => (
                  <li key={h.id}>
                    <button className="hist-item" onClick={() => {
                      setInput(h.question); setHistOpen(false); inputRef.current?.focus();
                    }}>
                      <span className="hist-q">{h.question}</span>
                      <span className="hist-meta">{new Date(h.created_at).toLocaleDateString('fr-FR')}
                        {h.status ? ` · ${h.status}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
