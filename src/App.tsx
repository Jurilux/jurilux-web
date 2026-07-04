import { useEffect, useRef, useState, FormEvent } from 'react';
import { ask, health, corpus, pdfHref, login, register, logout, changePassword, getHistory, me, clearSession,
  getStoredEmail, Citation, Corpus, Feedback, HistoryItem, Me, SearchFilters } from './api';
import { lawTitle, jurisDate, jurisCourt, jurisRef } from './juridictions';
import { LegalPage } from './Legal';

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
  if (c.source_type === 'law') return lawTitle(c.title || c.doc_id);
  if (c.source_type === 'projet_loi') return c.title || c.doc_id;
  return jurisCourt(c.doc_id, c.juridiction_key);
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
  const isProjet = c.source_type === 'projet_loi';
  const isLaw = c.source_type === 'law';
  const href = pdfHref(c);
  const excerpt = c.content ? c.content.replace(/\s+/g, ' ').trim().slice(0, 220) : null;
  const badgeClass = isProjet ? 'badge-projet' : isLaw ? 'badge-law' : 'badge-juris';
  const badgeText = isProjet ? 'Projet de loi' : isLaw ? 'Loi' : 'Jurisprudence';

  // Métadonnées explicites (date, référence) — surtout pour la jurisprudence.
  const meta: string[] = [];
  if (!isLaw && !isProjet) {
    const d = jurisDate(c.doc_id) || (c.year ? String(c.year) : null);
    if (d) meta.push(d);
    const r = jurisRef(c.doc_id);
    if (r) meta.push(`Réf. ${r}`);
  } else if (isProjet) {
    const num = (c.doc_id || '').replace(/^chd-/, '');
    if (num) meta.push(`n° ${num}`);
    if (c.year) meta.push(String(c.year));
  }

  return (
    <div className={`citation cite-${isProjet ? 'projet' : isLaw ? 'law' : 'juris'}`}>
      <div className="citation-head" onClick={() => setOpen(!open)}>
        <span className="ref">[{index + 1}]</span>
        <span className={`badge ${badgeClass}`}>{badgeText}</span>
        <span className="citation-title">{citationLabel(c)}</span>
      </div>
      {meta.length > 0 && <div className="citation-meta">{meta.join(' · ')}</div>}
      {open && excerpt && <p className="excerpt">« {excerpt}… »</p>}
      <div className="citation-actions">
        {isProjet ? (
          c.url
            ? <a href={c.url} target="_blank" rel="noopener noreferrer">Voir le dossier (chd.lu)</a>
            : <span className="muted">Dossier indisponible</span>
        ) : href ? (
          <>
            <a href={href} target="_blank" rel="noopener noreferrer">Ouvrir le PDF</a>
            <a href={href} download>Télécharger</a>
          </>
        ) : (
          <span className="muted">Document indisponible</span>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Rendu markdown minimal et SÛR : on échappe le HTML d'abord, puis on n'ajoute que
// nos propres balises connues (titres, gras, listes, paragraphes). Les références
// inline [ … doc_id … ] deviennent des exposants [n] renvoyant à la carte source.
function renderAnswer(md: string, citations: Citation[]): string {
  let text = escapeHtml(md || '');
  citations.forEach((c, i) => {
    if (!c.doc_id) return;
    const id = c.doc_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\[[^\\]]*${id}[^\\]]*\\]`, 'g'),
      `<sup class="refnum">${i + 1}</sup>`);
  });
  const inline = (s: string) => s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  const out: string[] = [];
  let list = '';
  const closeList = () => { if (list) { out.push(`</${list}>`); list = ''; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^#{1,3}\s+/.test(line)) { closeList(); const lvl = line.startsWith('###') ? 3 : 2; out.push(`<h${lvl}>${inline(line.replace(/^#{1,3}\s+/, ''))}</h${lvl}>`); }
    else if (/^[-*]\s+/.test(line)) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`); }
    else if (/^\d+[.)]\s+/.test(line)) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(line.replace(/^\d+[.)]\s+/, ''))}</li>`); }
    else if (line === '') { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join('\n');
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
      <div className="answer" dangerouslySetInnerHTML={{ __html: renderAnswer(m.content, m.citations || []) }} />

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
      <p className="sources-title">Sources · {citations.length} document{citations.length > 1 ? 's' : ''}</p>
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

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPw !== confirmPw) { setError('Les deux nouveaux mots de passe ne correspondent pas.'); return; }
    if (newPw.length < 8) { setError('Nouveau mot de passe trop court (8 caractères minimum).'); return; }
    setBusy(true);
    try {
      await changePassword(oldPw, newPw);
      setDone(true);
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
          <h2>Changer de mot de passe</h2>
          <button className="ghost close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {done ? (
          <>
            <p className="ok-msg">✓ Mot de passe modifié.</p>
            <button className="send" onClick={onClose}>Fermer</button>
          </>
        ) : (
          <form onSubmit={submit} className="auth-form">
            <label>Mot de passe actuel
              <input type="password" required autoFocus value={oldPw}
                onChange={(e) => setOldPw(e.target.value)} />
            </label>
            <label>Nouveau mot de passe
              <input type="password" required minLength={8} value={newPw}
                onChange={(e) => setNewPw(e.target.value)} placeholder="8 caractères minimum" />
            </label>
            <label>Confirmer le nouveau
              <input type="password" required value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)} />
            </label>
            {error && <p className="warn">⚠ {error}</p>}
            <button className="send" type="submit" disabled={busy}>{busy ? '…' : 'Enregistrer'}</button>
          </form>
        )}
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
  const [account, setAccount] = useState<Me | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pedagogical, setPedagogical] = useState(false);

  useEffect(() => {
    if (getStoredEmail()) me().then((a) => {
      if (a) { setAccount(a); setUser(a.email); }
      else { clearSession(); setUser(null); }  // token expiré
    });
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const openLegal = () => { setMenuOpen(false); setLegalOpen(true); };
  const [pwOpen, setPwOpen] = useState(false);
  const openPassword = () => { setMenuOpen(false); setPwOpen(true); };

  const onAuth = (email: string) => { setUser(email); me().then(setAccount); };
  const goHome = () => { setMessages([]); setInput(''); setMenuOpen(false); };
  const openHistory = async () => { setMenuOpen(false); setHistOpen(true); setHistory(await getHistory()); };
  const doLogout = async () => { await logout(); setUser(null); setAccount(null); setHistOpen(false); setMenuOpen(false); };
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
    (filters.juridiction_key?.trim() ? 1 : 0) +
    (filters.source_type ? 1 : 0);

  async function submit(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const res = await ask(question, 20, filters, 0, pedagogical);
      if (user) me().then(setAccount);  // rafraîchit le quota
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
        <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu">☰</button>
        <button className="brand-btn" onClick={goHome} title="Retour à l'accueil">
          <span className="logo">⚖</span><strong>Jurilux</strong>
        </button>
        <span className={`dot ${connected === null ? 'dot-wait' : connected ? 'dot-ok' : 'dot-ko'}`} />
        <span className="muted status-txt">{connected === null ? 'Vérification…' : connected ? 'Connecté' : 'Indisponible'}</span>
        <div className="header-actions">
          {user && account?.plan === 'student' && account.quota.limit != null && (
            <span className={`quota-badge ${account.quota.remaining === 0 ? 'quota-out' : ''}`}
              title="Questions ce mois (plan étudiant)">
              {account.quota.used}/{account.quota.limit}
            </span>
          )}
          {user
            ? <span className="account-email" title={user}>{user}</span>
            : <button className="send account-btn" onClick={() => setAuthOpen(true)}>Se connecter</button>}
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
              Type
              <select value={filters.source_type ?? ''}
                onChange={(e) => setFilters({ ...filters, source_type: e.target.value || undefined })}>
                <option value="">Tous</option>
                <option value="jurisprudence">Jurisprudence</option>
                <option value="law">Textes de loi</option>
                <option value="projet_loi">Projets de loi</option>
              </select>
            </label>
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
        <label className="pedago-toggle" title="Réponse didactique : principe → texte → jurisprudence">
          <input type="checkbox" checked={pedagogical} onChange={(e) => setPedagogical(e.target.checked)} />
          Mode pédagogique <span className="muted">(étudiant)</span>
        </label>
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
        <p className="hint muted">
          Shift+Enter : nouvelle ligne · les réponses ne constituent pas un avis juridique ·{' '}
          <button className="linklike legal-link" onClick={() => setLegalOpen(true)}>Mentions &amp; confidentialité</button>
          <span className="version" title="Version du build">{APP_VERSION}</span>
        </p>
      </footer>

      {menuOpen && (
        <div className="drawer-overlay left" onClick={() => setMenuOpen(false)}>
          <aside className="drawer nav-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div className="brand"><span className="logo">⚖</span><strong>Jurilux</strong></div>
              <button className="ghost close" onClick={() => setMenuOpen(false)} aria-label="Fermer">✕</button>
            </div>
            <nav className="nav-list">
              <button className="nav-item" onClick={goHome}>🏠 Accueil <span className="muted">— nouvelle recherche</span></button>
              {user && <button className="nav-item" onClick={openHistory}>🕑 Mon historique</button>}
              {!user && <button className="nav-item" onClick={() => { setMenuOpen(false); setAuthOpen(true); }}>👤 Se connecter / créer un compte</button>}
              <button className="nav-item" onClick={openLegal}>📄 Mentions légales &amp; confidentialité</button>
            </nav>

            {user && account && (
              <div className="nav-account">
                <div className="nav-label">Mon compte</div>
                <div className="account-email" title={user}>{user}</div>
                <div className="plan-row">
                  <span className={`plan-badge plan-${account.plan}`}>{account.plan === 'pro' ? 'Pro' : 'Étudiant'}</span>
                  {account.quota.limit != null && (
                    <span className="muted">{account.quota.remaining} / {account.quota.limit} questions restantes ce mois</span>
                  )}
                </div>
                <div className="account-actions">
                  <button className="ghost" onClick={openPassword}>Changer de mot de passe</button>
                  <button className="ghost" onClick={doLogout}>Déconnexion</button>
                </div>
              </div>
            )}

            {corpusInfo?.decisions != null && (
              <div className="nav-account">
                <div className="nav-label">Le corpus</div>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  <b>{corpusInfo.decisions.toLocaleString('fr-FR')}</b> décisions ·{' '}
                  <b>{corpusInfo.texts?.toLocaleString('fr-FR')}</b> textes de loi ·{' '}
                  <b>{corpusInfo.projets?.toLocaleString('fr-FR')}</b> projets de loi
                  {corpusInfo.updated && <> · à jour au {corpusInfo.updated.split('-').reverse().join('/')}</>}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuth={onAuth} />}

      {legalOpen && <LegalPage onClose={() => setLegalOpen(false)} />}

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}

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
