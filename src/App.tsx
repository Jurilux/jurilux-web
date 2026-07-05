import { useEffect, useRef, useState, Suspense, lazy, FormEvent } from 'react';
import { ask, askStream, health, corpus, pdfHref, login, register, logout, changePassword, sendFeedback, createShare, getHistory, me, clearSession,
  getStoredEmail, listAlerts, createAlert, AskResponse, Citation, Corpus, Feedback, HistoryItem, Me, SearchFilters } from './api';
import { lawTitle, jurisDate, jurisCourt, jurisRef } from './juridictions';

// Chargés à la demande (code splitting) : ces écrans ne pèsent pas sur le 1er rendu.
const LegalPage = lazy(() => import('./Legal').then((m) => ({ default: m.LegalPage })));
const Cabinet = lazy(() => import('./Cabinet').then((m) => ({ default: m.Cabinet })));
const SaveToDossierModal = lazy(() => import('./Cabinet').then((m) => ({ default: m.SaveToDossierModal })));
const Alerts = lazy(() => import('./Alerts').then((m) => ({ default: m.Alerts })));

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  question?: string;               // question d'origine (pour feedback / élargir)
  citations?: Citation[];
  refused?: boolean;
  status?: 'ok' | 'partial';
  feedback?: Feedback | null;
  suggested_question?: string | null;
  streaming?: boolean;             // réponse en cours de streaming
  error?: string;
}

// Exemples groupés par thème — questions PRÉCISES vérifiées comme aboutissant
// (une question trop large refuse ; on oriente l'utilisateur vers ce qui marche).
const PRESET_GROUPS: { theme: string; questions: string[] }[] = [
  { theme: 'Droit du travail', questions: [
    'Dans quels cas un licenciement avec effet immédiat est-il justifié selon la jurisprudence ?',
    'Quel est le préavis légal en cas de licenciement au Luxembourg ?',
    'Une absence injustifiée peut-elle constituer une faute grave ?',
    'Un employeur peut-il imposer des heures supplémentaires ?',
  ] },
  { theme: 'Bail & logement', questions: [
    "Quelles sont les conditions de résiliation d'un bail d'habitation au Luxembourg ?",
    'Le bailleur peut-il conserver la garantie locative après le départ du locataire ?',
  ] },
  { theme: 'Preuve & procédure', questions: [
    "Quel est le délai pour faire appel d'un jugement civil ?",
    'Quel est le délai de prescription d’une créance civile au Luxembourg ?',
  ] },
  { theme: 'Famille', questions: [
    "Sur quels critères le juge attribue-t-il la garde d'un enfant ?",
    'Comment est organisée l’autorité parentale après une séparation ?',
  ] },
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

// Construit un export Markdown de la réponse (question + réponse + sources), pour un dossier.
function buildExport(m: Message): string {
  const lines: string[] = ['# Question', '', m.question || '', '', '# Réponse Jurilux', '', m.content || ''];
  if (m.citations && m.citations.length > 0) {
    lines.push('', '## Sources', '');
    m.citations.forEach((c, i) => {
      const label = c.title || c.doc_id;
      const raw = pdfHref(c) || c.url || '';
      const href = raw && !raw.startsWith('http') ? window.location.origin + raw : raw;
      lines.push(`${i + 1}. ${label}${href ? ` — ${href}` : ''}`);
    });
  }
  lines.push('', '---', 'Généré par Jurilux (jurilux.lu) — ne constitue pas un avis juridique.');
  return lines.join('\n');
}

function ExportButton({ m }: { m: Message }) {
  const download = () => {
    const blob = new Blob([buildExport(m)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'jurilux-reponse.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <button className="copy-btn" onClick={download} title="Télécharger la réponse et ses sources (.md)">
      Exporter
    </button>
  );
}

function FollowButton({ m }: { m: Message }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const follow = async () => {
    setState('busy');
    try { await createAlert(m.question || ''); setState('done'); setTimeout(() => setState('idle'), 2500); }
    catch { setState('err'); setTimeout(() => setState('idle'), 2500); }
  };
  return (
    <button className="copy-btn" onClick={follow} disabled={state === 'busy'}
      title="Être alerté des nouvelles décisions sur ce sujet">
      {state === 'done' ? '✓ Sujet suivi' : state === 'busy' ? '…' : state === 'err' ? 'Échec' : '🔔 Suivre'}
    </button>
  );
}

function ShareButton({ m }: { m: Message }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  const share = async () => {
    setState('busy');
    try {
      const id = await createShare(m.question || '', m.content, m.citations || [], m.status || 'ok');
      const url = `${window.location.origin}/r/${id}`;
      try { await navigator.clipboard.writeText(url); } catch { /* presse-papier indisponible */ }
      setState('done'); setTimeout(() => setState('idle'), 2500);
    } catch { setState('err'); setTimeout(() => setState('idle'), 2500); }
  };
  return (
    <button className="copy-btn" onClick={share} disabled={state === 'busy'}
      title="Copier un lien vers cette réponse">
      {state === 'done' ? '✓ Lien copié' : state === 'busy' ? '…' : state === 'err' ? 'Échec' : 'Partager'}
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
export function renderAnswer(md: string, citations: Citation[]): string {
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

interface MsgActions {
  onSuggestion: (s: string) => void;   // pré-remplit l'input (reformulation à ajuster)
  onAsk: (q: string) => void;          // soumet directement (question-pivot)
  onBroaden: (m: Message) => void;     // retire les filtres et relance la question
  hasFilters: boolean;
  onSave: (m: Message) => void;        // ranger la réponse dans un dossier (cabinet)
  canSave: boolean;                    // connecté ?
}

// Boucle de satisfaction : 👍/👎 puis, si 👎, « qu'est-ce qui manquait ? ».
function FeedbackBar({ question, status }: { question: string; status: string }) {
  const [sent, setSent] = useState<'up' | 'down' | null>(null);
  const [asking, setAsking] = useState(false);
  const [missing, setMissing] = useState('');

  if (sent) return <div className="fb-bar"><span className="fb-thanks">Merci pour votre retour 🙏</span></div>;
  if (asking) {
    return (
      <form className="fb-bar fb-missing" onSubmit={(e) => {
        e.preventDefault(); sendFeedback(question, false, missing, status); setSent('down');
      }}>
        <input autoFocus value={missing} placeholder="Qu'est-ce qui manquait ?"
          onChange={(e) => setMissing(e.target.value)} />
        <button className="ghost" type="submit">Envoyer</button>
      </form>
    );
  }
  return (
    <div className="fb-bar">
      <span className="fb-q">Cette réponse vous aide ?</span>
      <button className="fb-btn" title="Utile"
        onClick={() => { sendFeedback(question, true, undefined, status); setSent('up'); }}>👍</button>
      <button className="fb-btn" title="Pas utile" onClick={() => setAsking(true)}>👎</button>
    </div>
  );
}

// Rebond : question-pivot (1 clic) + reformulations prêtes + élargissement des filtres.
function RecoveryActions({ m, actions }: { m: Message; actions: MsgActions }) {
  const pivot = m.suggested_question;
  const reforms = m.feedback?.how_to_improve || [];
  if (!pivot && reforms.length === 0 && !actions.hasFilters) return null;
  return (
    <div className="recovery">
      {pivot && (
        <div className="pivot">
          <span className="pivot-lead">👉 Je peux en revanche répondre précisément à :</span>
          <button className="pivot-btn" onClick={() => actions.onAsk(pivot)}>{pivot}</button>
        </div>
      )}
      {(reforms.length > 0 || actions.hasFilters) && (
        <div className="reforms">
          {reforms.length > 0 && <span className="reforms-lead">Ou affinez votre question :</span>}
          {reforms.map((s, i) => (
            <button key={i} className="chip" onClick={() => actions.onSuggestion(s)}>🔁 {s}</button>
          ))}
          {actions.hasFilters && (
            <button className="chip" onClick={() => actions.onBroaden(m)}>🎚️ Élargir — retirer les filtres</button>
          )}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ m, actions }: { m: Message; actions: MsgActions }) {
  if (m.error) {
    return (
      <div className="bubble assistant">
        <div className="bubble-tag">Jurilux</div>
        <p className="warn">⚠ {m.error}</p>
        <FeedbackBar question={m.question || ''} status="error" />
      </div>
    );
  }
  if (m.streaming) {
    return (
      <div className="bubble assistant">
        <div className="bubble-tag">Jurilux</div>
        {m.content
          ? <div className="answer" dangerouslySetInnerHTML={{ __html: renderAnswer(m.content, []) }} />
          : <p className="typing">Recherche dans les sources…</p>}
        <span className="stream-cursor" aria-hidden="true">▌</span>
      </div>
    );
  }
  if (m.refused) {
    const pistes = !!(m.citations && m.citations.length > 0);
    return (
      <div className="bubble assistant">
        <div className="bubble-tag">Jurilux</div>
        {m.content
          ? <div className="answer" dangerouslySetInnerHTML={{ __html: renderAnswer(m.content, []) }} />
          : <p className="rebound-lead">
              Je n'ai pas de réponse certaine sur ce point précis{pistes ? ", mais voici ce que j'ai trouvé de plus proche." : "."}
            </p>}
        {!m.content && m.feedback?.why && <p className="rebound-why">{m.feedback.why}</p>}
        <RecoveryActions m={m} actions={actions} />
        {pistes && <Sources citations={m.citations!} label="Pistes proches" />}
        <FeedbackBar question={m.question || ''} status="refused" />
      </div>
    );
  }
  return (
    <div className="bubble assistant">
      <div className="bubble-head">
        <div className="bubble-tag">
          Jurilux {m.status === 'partial' && <span className="badge badge-partial">Réponse partielle</span>}
        </div>
        {m.content && (
          <div className="msg-actions">
            <ShareButton m={m} />
            <ExportButton m={m} />
            {actions.canSave && <button className="copy-btn" title="Ranger dans un dossier"
              onClick={() => actions.onSave(m)}>Enregistrer</button>}
            {actions.canSave && <FollowButton m={m} />}
            <CopyButton text={m.content} />
          </div>
        )}
      </div>
      <div className="answer" dangerouslySetInnerHTML={{ __html: renderAnswer(m.content, m.citations || []) }} />

      {m.status === 'partial' && m.feedback && (m.feedback.why || m.feedback.limits) && (
        <div className="feedback">
          {m.feedback.why && <p><strong>Pourquoi partiel :</strong> {m.feedback.why}</p>}
          {m.feedback.limits && <p className="muted">{m.feedback.limits}</p>}
        </div>
      )}

      {m.status === 'partial' && <RecoveryActions m={m} actions={actions} />}

      {m.citations && m.citations.length > 0 && <Sources citations={m.citations} />}
      <FeedbackBar question={m.question || ''} status={m.status || 'ok'} />
    </div>
  );
}

export function Sources({ citations, label }: { citations: Citation[]; label?: string }) {
  const juris = citations.filter((c) => c.source_type !== 'law');
  const laws = citations.filter((c) => c.source_type === 'law');
  return (
    <div className="sources">
      <p className="sources-title">{label || 'Sources'} · {citations.length} document{citations.length > 1 ? 's' : ''}</p>
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
  const [cabOpen, setCabOpen] = useState(false);
  const openCabinet = () => { setMenuOpen(false); setCabOpen(true); };
  const [saveItem, setSaveItem] = useState<Message | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const openAlerts = () => { setMenuOpen(false); setAlertsOpen(true); };
  const [alertUnseen, setAlertUnseen] = useState(0);
  const refreshAlerts = () => { if (getStoredEmail()) listAlerts().then((a) => setAlertUnseen(a.reduce((n, x) => n + x.unseen, 0))).catch(() => {}); };
  useEffect(refreshAlerts, []);

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

  async function submit(q: string, overrideFilters?: SearchFilters) {
    const question = q.trim();
    if (!question || loading) return;
    const usedFilters = overrideFilters ?? filters;
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    const aid = `a${Date.now()}`;
    setMessages((prev) => [...prev, { id: aid, role: 'assistant', content: '', question, streaming: true }]);

    // Dédup : doc_id pour la jurisprudence, titre parsé pour les lois.
    const dedup = (cites: Citation[]) => {
      const seen = new Set<string>();
      return (cites || []).filter((c) => {
        const key = c.source_type === 'law' ? `law:${lawTitle(c.title || c.doc_id)}` : c.doc_id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const finalize = (meta: AskResponse) => setMessages((prev) => prev.map((m) => m.id === aid ? {
      ...m, streaming: false,
      content: meta.answer ?? m.content,
      citations: dedup(meta.citations || []),
      refused: meta.refused, status: meta.status,
      feedback: meta.feedback, suggested_question: meta.suggested_question,
    } : m));

    try {
      await askStream(question, 20, usedFilters, 0, pedagogical,
        (delta) => setMessages((prev) => prev.map((m) => m.id === aid ? { ...m, content: m.content + delta } : m)),
        finalize);
    } catch {
      // repli non-streamé si le flux échoue
      try {
        finalize(await ask(question, 20, usedFilters, 0, pedagogical));
      } catch (err) {
        setMessages((prev) => prev.map((m) => m.id === aid ? {
          ...m, streaming: false, error: err instanceof Error ? err.message : String(err),
        } : m));
      }
    } finally {
      if (user) me().then(setAccount);  // rafraîchit le quota
      setLoading(false);
    }
  }

  const filtersPanel = showFilters ? (
    <div className="filters">
      <label>Type
        <select value={filters.source_type ?? ''}
          onChange={(e) => setFilters({ ...filters, source_type: e.target.value || undefined })}>
          <option value="">Tous</option>
          <option value="jurisprudence">Jurisprudence</option>
          <option value="law">Textes de loi</option>
          <option value="projet_loi">Projets de loi</option>
        </select>
      </label>
      <label>Année min
        <input type="number" min={1900} max={2100} value={filters.year_min ?? ''}
          onChange={(e) => setFilters({ ...filters, year_min: e.target.value ? Number(e.target.value) : undefined })} />
      </label>
      <label>Année max
        <input type="number" min={1900} max={2100} value={filters.year_max ?? ''}
          onChange={(e) => setFilters({ ...filters, year_max: e.target.value ? Number(e.target.value) : undefined })} />
      </label>
      <label>Juridiction
        <input type="text" placeholder="ex : csj_ch04" value={filters.juridiction_key ?? ''}
          onChange={(e) => setFilters({ ...filters, juridiction_key: e.target.value || undefined })} />
      </label>
      {activeFilters > 0 && <button className="ghost" onClick={() => setFilters({})}>Effacer</button>}
    </div>
  ) : null;

  return (
    <div className="app">
      <aside className="sidebar">
        <button className="side-brand" onClick={goHome} title="Nouvelle recherche">
          <span className="side-mark">J</span><span className="side-name">Jurilux</span><span className="side-loc">LU</span>
        </button>
        <button className="side-cta" onClick={goHome}><span className="plus">+</span> Nouvelle recherche</button>

        <div className="side-label">Rechercher</div>
        <button className="nav-item active" onClick={goHome}><span className="ico">⌕</span> Recherche</button>
        {user && <button className="nav-item" onClick={openHistory}><span className="ico">◷</span> Historique</button>}
        {user && <button className="nav-item" onClick={openCabinet}><span className="ico">▤</span> Mon cabinet</button>}
        {user && <button className="nav-item" onClick={openAlerts}>
          <span className="ico">◆</span> Alertes{alertUnseen > 0 && <span className="badge">{alertUnseen}</span>}</button>}

        {account?.is_admin && (
          <>
            <div className="side-label">Explorer</div>
            <a className="nav-item" href="/insight"><span className="ico">⚖</span> Insight — avocats</a>
            <a className="nav-item" href="/admin"><span className="ico">▦</span> Administration</a>
          </>
        )}

        <div className="side-foot">
          {user ? (
            <div className="side-account">
              <span className="avatar">{user.charAt(0).toUpperCase()}</span>
              <span className="who">
                <span className="em" title={user}>{user}</span>
                <span className="plan">{account?.plan === 'pro' ? 'Plan pro' : 'Plan étudiant'}</span>
              </span>
              {account?.plan === 'student' && account.quota.limit != null &&
                <span className="quota">{account.quota.used}/{account.quota.limit}</span>}
            </div>
          ) : (
            <button className="side-signin" onClick={() => setAuthOpen(true)}>Se connecter</button>
          )}
          <button className="side-legal linklike" onClick={() => setLegalOpen(true)}>Mentions &amp; confidentialité</button>
        </div>
      </aside>

      <header className="mobile-head">
        <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu">☰</button>
        <button className="brand-btn" onClick={goHome} title="Accueil">
          <span className="logo">⚖</span><strong>Jurilux</strong>
        </button>
        <div className="header-actions">
          {user && account?.plan === 'student' && account.quota.limit != null && (
            <span className={`quota-badge ${account.quota.remaining === 0 ? 'quota-out' : ''}`}>
              {account.quota.used}/{account.quota.limit}
            </span>
          )}
          {!user && <button className="send account-btn" onClick={() => setAuthOpen(true)}>Se connecter</button>}
        </div>
      </header>

      <main className="workspace">
        <div className="topbar">
          <span className="status">
            <span className={`dot ${connected === null ? 'dot-wait' : connected ? 'dot-ok' : 'dot-ko'}`} />
            {connected === null ? 'Vérification…' : connected ? 'Corpus connecté' : 'Service indisponible'}
          </span>
          <span className="spacer" />
          <label className="pedago-mini" title="Réponse didactique : principe → texte → jurisprudence">
            <input type="checkbox" checked={pedagogical} onChange={(e) => setPedagogical(e.target.checked)} />
            Mode pédagogique
          </label>
        </div>

        {messages.length === 0 ? (
          <div className="content">
            <div className="inner welcome">
              <section className="hero">
                <div className="hero-kicker">Recherche juridique · Grand-Duché de Luxembourg</div>
                <h1>Quelle question de droit&nbsp;?</h1>
                <p className="hero-lead">
                  Posez-la en langage naturel. Chaque réponse est fondée sur la jurisprudence et la
                  législation luxembourgeoises, avec des <b>sources vérifiables</b>.
                </p>
                <div className="search-hero">
                  <textarea ref={inputRef} value={input} rows={1}
                    placeholder="Posez votre question juridique…"
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }} />
                  <div className="sh-actions">
                    <button className={`ghost filter-toggle ${activeFilters > 0 ? 'active' : ''}`} title="Filtres"
                      onClick={() => setShowFilters(!showFilters)}>⚙{activeFilters > 0 ? ` ${activeFilters}` : ''}</button>
                    <button className="go" disabled={!input.trim() || loading} onClick={() => submit(input)}>Rechercher</button>
                  </div>
                </div>
                {filtersPanel}
                {corpusInfo && corpusInfo.decisions != null && (
                  <p className="corpus-scope">
                    <b>{corpusInfo.decisions.toLocaleString('fr-FR')}</b> décisions
                    {corpusInfo.texts != null && <> · <b>{corpusInfo.texts.toLocaleString('fr-FR')}</b> textes de loi</>}
                    {corpusInfo.projets != null && <> · <b>{corpusInfo.projets.toLocaleString('fr-FR')}</b> projets</>}
                    {corpusInfo.updated && <> · à jour au {corpusInfo.updated.split('-').reverse().join('/')}</>}
                  </p>
                )}
                <p className="hero-disclaimer">Les réponses ne constituent pas un avis juridique.</p>
              </section>
              <section className="suggest">
                <div className="suggest-label">Exemples de questions</div>
                <div className="suggest-list">
                  {PRESET_GROUPS.map((g) => g.questions[0]).filter(Boolean).map((p, i) => (
                    <button key={i} className="sugg" onClick={() => submit(p)} disabled={loading}>{p}</button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <>
            <div className="content">
              <div className="inner">
                <div className="thread">
                  {messages.map((m) =>
                    m.role === 'user' ? (
                      <div key={m.id} className="bubble user"><p>{m.content}</p></div>
                    ) : (
                      <AssistantMessage key={m.id} m={m} actions={{
                        onSuggestion: (s) => { setInput(s); inputRef.current?.focus(); },
                        onAsk: (qq) => submit(qq),
                        onBroaden: (mm) => { setFilters({}); submit(mm.question || '', {}); },
                        hasFilters: activeFilters > 0,
                        onSave: (mm) => setSaveItem(mm),
                        canSave: !!user,
                      }} />
                    ),
                  )}
                  <div ref={endRef} />
                </div>
              </div>
            </div>
            <div className="composer-bar">
              <div className="inner">
                {filtersPanel}
                <div className="input-row">
                  <textarea ref={inputRef} value={input} rows={1} placeholder="Poser une autre question…"
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }} />
                  <button className={`ghost filter-toggle ${activeFilters > 0 ? 'active' : ''}`} title="Filtres"
                    onClick={() => setShowFilters(!showFilters)}>⚙{activeFilters > 0 ? ` ${activeFilters}` : ''}</button>
                  <button className="send" disabled={!input.trim() || loading} onClick={() => submit(input)}>Envoyer</button>
                </div>
                <p className="hint muted">
                  Shift+Enter : nouvelle ligne · les réponses ne constituent pas un avis juridique
                  <span className="version" title="Version du build">{APP_VERSION}</span>
                </p>
              </div>
            </div>
          </>
        )}
      </main>

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
              {user && <button className="nav-item" onClick={openCabinet}>🗂️ Mon cabinet <span className="muted">— dossiers partagés</span></button>}
              {user && <button className="nav-item" onClick={openAlerts}>🔔 Mes alertes {alertUnseen > 0 && <span className="alert-badge">{alertUnseen}</span>} <span className="muted">— veille</span></button>}
              {account?.is_admin && <a className="nav-item nav-admin" href="/admin">🎛️ Administration <span className="muted">— backoffice</span></a>}
              {account?.is_admin && <a className="nav-item nav-admin" href="/insight">⚖️ Insight <span className="muted">— avocats</span></a>}
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

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}

      <Suspense fallback={null}>
        {legalOpen && <LegalPage onClose={() => setLegalOpen(false)} />}
        {cabOpen && <Cabinet onClose={() => setCabOpen(false)} />}
        {alertsOpen && <Alerts onClose={() => { setAlertsOpen(false); refreshAlerts(); }} />}
        {saveItem && <SaveToDossierModal onClose={() => setSaveItem(null)} item={{
          question: saveItem.question || '', answer: saveItem.content || null,
          citations: saveItem.citations || [], status: saveItem.status,
        }} />}
      </Suspense>

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
