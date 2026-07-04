import { useEffect, useRef, useState } from 'react';
import { ask, health, pdfHref, Citation, Feedback, SearchFilters } from './api';
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

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { health().then(setConnected); }, []);
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
        <button className="ghost" onClick={() => { setMessages([]); setInput(''); }}>Nouvelle discussion</button>
      </header>

      <main>
        {messages.length === 0 ? (
          <div className="welcome">
            <h1>Assistant juridique Jurilux</h1>
            <p className="muted">
              Posez vos questions en langage naturel. Les réponses sont fondées sur la jurisprudence et la
              législation luxembourgeoises, avec sources vérifiables.
            </p>
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
      </footer>
    </div>
  );
}
