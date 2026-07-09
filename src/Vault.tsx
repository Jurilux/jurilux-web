import { useEffect, useState, FormEvent, ChangeEvent } from 'react';
import {
  listVaultDocs, vaultUpload, deleteVaultDoc, vaultAsk,
  vaultCitations, vaultExtract, vaultSummary, vaultCounter, vaultTimeline,
  vaultChain, ChainStep, Verification,
} from './api';
import { VerifBadge } from './VerifBadge';
import {
  vaultReview, listPlaybooks, createPlaybook, deletePlaybook, reviewContract,
  pdfHref, getToken, HttpError,
  VaultDoc, AskResponse, CitationCheck, VaultStructure, TimelineEvent,
  VaultReviewRow, Playbook, PlaybookRule, ContractReview,
} from './api';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

// ---------- utilitaires ----------
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR') + ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Message d'erreur lisible ; le 503 (service d'analyse indisponible) est explicité.
function errMsg(e: unknown): string {
  if (e instanceof HttpError && e.status === 503) {
    return "Service d'analyse indisponible (503) — réessayez dans un instant.";
  }
  return e instanceof Error ? e.message : 'Une erreur est survenue.';
}

function statusBadge(s: VaultDoc['status']) {
  const map: Record<VaultDoc['status'], { cls: string; label: string }> = {
    ready: { cls: 'st-ok', label: 'prêt' },
    indexing: { cls: 'st-partial', label: 'indexation…' },
    error: { cls: 'st-other', label: 'erreur' },
  };
  const m = map[s] || map.error;
  return <span className={`q-status ${m.cls}`}>{m.label}</span>;
}

// Badge coloré pour un statut de revue de contrat (styles inline : aucune classe dédiée).
function findingStyle(status: 'ok' | 'issue' | 'missing'): React.CSSProperties {
  const palette = {
    ok: { bg: 'var(--green-soft)', fg: 'var(--green)' },
    issue: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
    missing: { bg: '#f7e6e6', fg: 'var(--ko)' },
  }[status];
  return {
    background: palette.bg, color: palette.fg, fontFamily: 'var(--mono)',
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
    textTransform: 'uppercase', letterSpacing: '.04em',
  };
}
const findingLabel: Record<'ok' | 'issue' | 'missing', string> = {
  ok: 'conforme', issue: 'à revoir', missing: 'absent',
};

// ---------- citations d'une réponse (réutilisé Q&A + contre-argumentaire) ----------
function CitationList({ resp }: { resp: AskResponse }) {
  if (!resp.citations || resp.citations.length === 0) return null;
  return (
    <div className="sources" style={{ margin: '14px 0 0', borderRadius: 12 }}>
      <div className="sources-title">Sources ({resp.citations.length})</div>
      {resp.citations.map((c, i) => {
        const href = pdfHref(c);
        const cls = c.source_type === 'law' ? 'cite-law'
          : c.source_type === 'projet_loi' ? 'cite-projet' : '';
        return (
          <div className={`citation ${cls}`} key={`${c.doc_id}-${i}`}>
            <div className="citation-head">
              <span className="ref">{c.doc_id}</span>
              {c.year && <span className="year">{c.year}</span>}
              {c.title && <span className="citation-title">{c.title}</span>}
            </div>
            {c.content && <p className="excerpt">{c.content}</p>}
            {href && (
              <div className="citation-actions">
                <a href={href} target="_blank" rel="noopener noreferrer">Ouvrir le PDF ↗</a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
//  Panneau d'analyses d'un document
// ============================================================================
type AnalysisTask = 'citations' | 'extract' | 'summary' | 'counter' | 'timeline';

function AnalysisPanel({ doc }: { doc: VaultDoc }) {
  const [task, setTask] = useState<AnalysisTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [citations, setCitations] = useState<{ references: CitationCheck[]; verified: number; total: number } | null>(null);
  const [extract, setExtract] = useState<VaultStructure | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [counter, setCounter] = useState<{ answer: string | null; refused: boolean;
    citations: AskResponse['citations']; verification?: Verification | null } | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);

  // Changement de document : on repart d'un panneau vierge.
  useEffect(() => {
    setTask(null); setError(null); setBusy(false); setChain(null);
    setCitations(null); setExtract(null); setSummary(null); setCounter(null); setTimeline(null);
  }, [doc.id]);

  const run = async (t: AnalysisTask) => {
    setTask(t); setError(null); setBusy(true); setChain(null);
    try {
      if (t === 'citations') setCitations(await vaultCitations(doc.id));
      else if (t === 'extract') setExtract(await vaultExtract(doc.id));
      else if (t === 'summary') setSummary((await vaultSummary(doc.id)).summary);
      else if (t === 'counter') setCounter(await vaultCounter(doc.id));
      else if (t === 'timeline') setTimeline((await vaultTimeline(doc.id)).events);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // Chaîne de travail (B11 v1) : citations → contre-argumentaire → résumé en UN geste.
  const [chain, setChain] = useState<ChainStep[] | null>(null);
  const runChain = async () => {
    setTask(null); setError(null); setBusy(true); setChain(null);
    try { setChain((await vaultChain(doc.id, ['citations', 'counter', 'summary'])).steps); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  const buttons: { key: AnalysisTask; label: string }[] = [
    { key: 'citations', label: 'Vérifier les citations' },
    { key: 'extract', label: 'Extraire' },
    { key: 'summary', label: 'Résumé' },
    { key: 'counter', label: 'Contre-argumentaire' },
    { key: 'timeline', label: 'Chronologie' },
  ];

  return (
    <div className="panel">
      <div className="panel-title">Analyses — {doc.filename}</div>
      {doc.status !== 'ready' && (
        <p className="muted small">Le document est {doc.status === 'indexing' ? "en cours d'indexation" : 'en erreur'} :
          les analyses peuvent échouer tant qu'il n'est pas prêt.</p>
      )}
      <div className="insight-chips" style={{ marginBottom: 14 }}>
        {buttons.map((b) => (
          <button key={b.key} className={`chip${task === b.key ? ' chip-lateral' : ''}`}
            disabled={busy} onClick={() => run(b.key)}>{b.label}</button>
        ))}
        <button className={`chip${chain ? ' chip-lateral' : ''}`} disabled={busy} onClick={runChain}
          title="Vérifier les citations, produire le contre-argumentaire puis le résumé — en un geste">
          ⚡ Chaîne complète</button>
      </div>

      {busy && <p className="muted">Analyse en cours…</p>}
      {error && <p className="warn">⚠ {error}</p>}

      {!busy && task === 'citations' && citations && (
        <>
          <p className="muted small">{citations.verified} / {citations.total} référence(s) vérifiée(s) dans le corpus.</p>
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>Référence</th><th>Vérifiée</th><th>Source</th><th>PDF</th></tr></thead>
              <tbody>
                {citations.references.map((r, i) => (
                  <tr key={i}>
                    <td>{r.ref}</td>
                    <td>{r.verified ? <span className="ok">✓</span> : <span className="ko">✗</span>}</td>
                    <td className="muted">{r.source_type || '—'}</td>
                    <td>{r.doc_id
                      ? <a href={`/docs/${r.doc_id}.pdf`} target="_blank" rel="noopener noreferrer">Ouvrir ↗</a>
                      : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {citations.references.length === 0 && (
                  <tr><td colSpan={4} className="muted">Aucune référence détectée.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!busy && task === 'extract' && extract && (
        <div className="kv-grid">
          <div className="kv"><span>Matière</span><b>{extract.matter || '—'}</b></div>
          <div className="kv"><span>Issue</span><b>{extract.outcome || '—'}</b></div>
          <div className="kv"><span>Montants</span><b>{extract.amounts.length ? extract.amounts.join(' · ') : '—'}</b></div>
          <div className="kv"><span>Avocats</span>
            <b>{extract.lawyers.length
              ? extract.lawyers.map((l) => l.name + (l.side ? ` (${l.side})` : '')).join(', ')
              : '—'}</b></div>
          <div className="kv"><span>Références</span><b>{extract.references.length ? extract.references.join(', ') : '—'}</b></div>
        </div>
      )}

      {!busy && task === 'summary' && summary && (
        <p style={{ whiteSpace: 'pre-wrap' }}>{summary}</p>
      )}

      {!busy && task === 'counter' && counter && (
        counter.refused || !counter.answer ? (
          <p className="muted">Aucun contre-argumentaire produit (le modèle a refusé faute d'éléments suffisants).</p>
        ) : (
          <>
            <p style={{ whiteSpace: 'pre-wrap' }}>{counter.answer}</p>
            <VerifBadge v={counter.verification} />
            <CitationList resp={{ answer: counter.answer, citations: counter.citations, refused: counter.refused }} />
          </>
        )
      )}

      {!busy && task === 'timeline' && timeline && (
        timeline.length === 0 ? (
          <p className="muted">Aucun événement daté détecté.</p>
        ) : (
          <div className="insight-cases">
            {timeline.map((ev, i) => (
              <div className="case-row" key={i} style={{ cursor: 'default' }}>
                <span className="case-court" style={{ minWidth: 96 }}>{ev.date}</span>
                <span className="case-meta muted">{ev.contexte}</span>
              </div>
            ))}
          </div>
        )
      )}

      {/* Chaîne de travail : les étapes s'empilent dans l'ordre d'exécution. */}
      {!busy && chain && (
        <div className="chain-results">
          {chain.map((s, i) => (
            <section className="chain-step" key={i}>
              <h4 className="chain-step-title">
                <span className="chain-step-num">{i + 1}</span>
                {s.task === 'citations' ? 'Citations vérifiées'
                  : s.task === 'counter' ? 'Contre-argumentaire'
                  : s.task === 'summary' ? 'Résumé'
                  : s.task === 'timeline' ? 'Chronologie' : 'Extraction'}
              </h4>
              {s.error ? <p className="warn">⚠ Étape indisponible : {s.error}</p>
                : s.task === 'citations' ? (
                  <p className="muted small">{s.verified} / {s.total} référence(s) vérifiée(s) dans le corpus
                    {(s.references || []).some((r) => !r.verified) &&
                      <> — <b>{(s.references || []).filter((r) => !r.verified).length} non retrouvée(s)</b> (à contrôler)</>}.
                  </p>
                ) : s.task === 'counter' ? (
                  s.refused || !s.answer
                    ? <p className="muted">Aucun contre-argumentaire produit (éléments insuffisants).</p>
                    : <><p style={{ whiteSpace: 'pre-wrap' }}>{s.answer}</p><VerifBadge v={s.verification} /></>
                ) : s.task === 'summary' ? (
                  <p style={{ whiteSpace: 'pre-wrap' }}>{s.summary}</p>
                ) : (
                  <p className="muted small">Étape exécutée.</p>
                )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  Q&A Vault
// ============================================================================
function VaultAsk() {
  const [q, setQ] = useState('');
  const [includeCorpus, setIncludeCorpus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<AskResponse | null>(null);

  const submit = async (question: string) => {
    const text = question.trim();
    if (!text) return;
    setBusy(true); setError(null);
    try {
      setResp(await vaultAsk(text, { include_corpus: includeCorpus }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(q); };

  return (
    <div className="panel">
      <div className="panel-title">Interroger le Vault</div>
      <form onSubmit={onSubmit} className="probe-form">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Ex : quels sont les délais de préavis mentionnés dans mes documents ?" />
        <button className="send" type="submit" disabled={busy || !q.trim()}>{busy ? '…' : 'Demander'}</button>
      </form>
      <label className="pedago-toggle" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={includeCorpus} onChange={(e) => setIncludeCorpus(e.target.checked)} />
        Inclure le corpus public officiel (recherche hybride)
      </label>

      {error && <p className="warn">⚠ {error}</p>}

      {resp && (
        <div style={{ marginTop: 14 }}>
          {resp.refused || !resp.answer ? (
            <p className="muted">Le modèle n'a pas pu répondre à partir de vos documents.</p>
          ) : (
            <>
              <p style={{ whiteSpace: 'pre-wrap' }}>{resp.answer}</p>
              <CitationList resp={resp} />
            </>
          )}
          {resp.follow_ups && resp.follow_ups.length > 0 && (
            <div className="followups">
              <span className="followups-lead">Pour aller plus loin :</span>
              <ul className="followups-list">
                {resp.follow_ups.map((f, i) => (
                  <li key={i}>
                    <button className="followup-btn" disabled={busy}
                      onClick={() => { setQ(f); submit(f); }}>{f}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  Revue tabulaire (comparer plusieurs documents)
// ============================================================================
function ReviewTable({ docIds, onClose }: { docIds: number[]; onClose: () => void }) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<VaultReviewRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy(true); setError(null);
    vaultReview(docIds)
      .then((d) => { if (alive) setRows(d.rows); })
      .catch((e) => { if (alive) setError(errMsg(e)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [docIds]);

  return (
    <div className="panel">
      <div className="corpus-head">
        <div className="panel-title">Comparaison — {docIds.length} document(s)</div>
        <button className="ghost" onClick={onClose}>Fermer</button>
      </div>
      {busy && <p className="muted">Extraction en cours…</p>}
      {error && <p className="warn">⚠ {error}</p>}
      {!busy && rows && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr>
              <th>Document</th><th>Matière</th><th>Issue</th><th>Montants</th><th>Avocats</th><th>Références</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.doc_id}>
                  <td>{r.filename}</td>
                  <td>{r.matter || '—'}</td>
                  <td>{r.outcome || '—'}</td>
                  <td>{r.amounts.length ? r.amounts.join(' · ') : '—'}</td>
                  <td>{r.lawyers.length ? r.lawyers.map((l) => l.name + (l.side ? ` (${l.side})` : '')).join(', ') : '—'}</td>
                  <td className="muted">{r.references.length ? r.references.join(', ') : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="muted">Aucun résultat.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
//  Revue de contrat (playbooks)
// ============================================================================
function PlaybookManager({ docs }: { docs: VaultDoc[] }) {
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Création
  const [name, setName] = useState('');
  const [rules, setRules] = useState<PlaybookRule[]>([{ label: '', instruction: '' }]);
  const [creating, setCreating] = useState(false);

  // Revue
  const [docId, setDocId] = useState<number | ''>('');
  const [playbookId, setPlaybookId] = useState<number | ''>('');
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<ContractReview | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listPlaybooks().then(setPlaybooks).catch((e) => setError(errMsg(e)));
  };
  useEffect(load, []);

  const addRule = () => setRules((rs) => [...rs, { label: '', instruction: '' }]);
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));
  const setRule = (i: number, patch: Partial<PlaybookRule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = rules.filter((r) => r.label.trim() && r.instruction.trim());
    if (!name.trim() || cleaned.length === 0) return;
    setCreating(true); setError(null);
    try {
      await createPlaybook(name.trim(), cleaned);
      setName(''); setRules([{ label: '', instruction: '' }]);
      load();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Supprimer ce playbook ?')) return;
    try { await deletePlaybook(id); load(); }
    catch (e) { setError(errMsg(e)); }
  };

  const runReview = async () => {
    if (docId === '' || playbookId === '') return;
    setReviewing(true); setReviewErr(null); setReview(null);
    try {
      setReview(await reviewContract(Number(docId), Number(playbookId)));
    } catch (e) {
      setReviewErr(errMsg(e));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">Revue de contrat</div>
      {error && <p className="warn">⚠ {error}</p>}

      {/* Lancer une revue */}
      <div className="cab-form" style={{ flexWrap: 'wrap' }}>
        <select value={docId} onChange={(e: ChangeEvent<HTMLSelectElement>) => setDocId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Choisir un document…</option>
          {docs.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
        </select>
        <select value={playbookId} onChange={(e: ChangeEvent<HTMLSelectElement>) => setPlaybookId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Choisir un playbook…</option>
          {(playbooks || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.rules.length} règle{p.rules.length > 1 ? 's' : ''})</option>)}
        </select>
        <button className="send" disabled={reviewing || docId === '' || playbookId === ''} onClick={runReview}>
          {reviewing ? '…' : 'Analyser'}
        </button>
      </div>

      {reviewErr && <p className="warn">⚠ {reviewErr}</p>}

      {review && (
        <div style={{ marginTop: 14 }}>
          <p className="muted small">
            Playbook « {review.playbook} » ·
            {' '}<b className="ok">{review.summary.ok} conforme(s)</b> ·
            {' '}<b style={{ color: 'var(--amber)' }}>{review.summary.issue} à revoir</b> ·
            {' '}<b className="ko">{review.summary.missing} absent(s)</b> ·
            {' '}{review.summary.total} point(s)
          </p>
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>Point de contrôle</th><th>Statut</th><th>Constat</th></tr></thead>
              <tbody>
                {review.findings.map((f, i) => (
                  <tr key={i}>
                    <td>{f.label}</td>
                    <td><span style={findingStyle(f.status)}>{findingLabel[f.status]}</span></td>
                    <td className="muted">
                      {f.note || '—'}
                      {/* Redline : passage actuel barré → clause proposée, copiable. */}
                      {f.suggestion && (
                        <div className="redline">
                          {f.extrait && <p className="redline-avant">{f.extrait}</p>}
                          <p className="redline-apres">{f.suggestion}</p>
                          <button className="linklike small"
                            onClick={() => navigator.clipboard.writeText(f.suggestion!).catch(() => {})}>
                            Copier la clause proposée
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {review.findings.length === 0 && <tr><td colSpan={3} className="muted">Aucun point de contrôle.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Playbooks existants */}
      <div className="cab-section">
        <div className="panel-title" style={{ fontSize: '1rem' }}>Playbooks</div>
        {!playbooks ? <p className="muted">Chargement…</p> : playbooks.length === 0 ? (
          <p className="muted small">Aucun playbook. Créez-en un ci-dessous.</p>
        ) : (
          <div className="cab-items">
            {playbooks.map((p) => (
              <div className="cab-row" key={p.id}>
                <span><b>{p.name}</b> <span className="muted small">— {p.rules.length} règle{p.rules.length > 1 ? 's' : ''} · {p.scope}</span></span>
                <button className="row-del" onClick={() => remove(p.id)}>Supprimer</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Création d'un playbook */}
      <form className="cab-section" onSubmit={create}>
        <div className="panel-title" style={{ fontSize: '1rem' }}>Nouveau playbook</div>
        <div className="cab-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du playbook (ex : NDA standard)" />
        </div>
        <div className="cab-items" style={{ marginTop: 10 }}>
          {rules.map((r, i) => (
            <div className="cab-form" key={i} style={{ marginTop: 0 }}>
              <input value={r.label} onChange={(e) => setRule(i, { label: e.target.value })}
                placeholder="Intitulé (ex : clause de confidentialité)" />
              <input value={r.instruction} onChange={(e) => setRule(i, { instruction: e.target.value })}
                placeholder="Ce qui doit être vérifié" />
              <button type="button" className="ghost" onClick={() => removeRule(i)} disabled={rules.length === 1}>✕</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" className="ghost" onClick={addRule}>+ Ajouter une règle</button>
          <button type="submit" className="send" disabled={creating || !name.trim()}>
            {creating ? '…' : 'Créer le playbook'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================================
//  Page Vault
// ============================================================================
export default function VaultApp() {
  const [docs, setDocs] = useState<VaultDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [showReview, setShowReview] = useState(false);

  // Dépôt
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listVaultDocs().then(setDocs).catch((e) => setError(errMsg(e)));
  };
  useEffect(() => { if (getToken()) load(); }, []);

  if (!getToken()) {
    return (
      <div className="admin-gate">
        <div className="admin-login">
          <div className="admin-brand"><span className="logo">⚖</span><strong>Jurilux</strong>
            <span className="admin-tag">Vault</span></div>
          <p className="muted">Connectez-vous pour utiliser votre Vault.</p>
          <p className="muted small"><a href="/">← Retour à l'accueil</a></p>
        </div>
      </div>
    );
  }

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-déposer le même fichier
    if (!file) return;
    setUploading(true); setUploadMsg(null); setError(null);
    try {
      const doc = await vaultUpload(file, file.name);
      setUploadMsg(`« ${doc.filename} » déposé — statut : ${doc.status}.`);
      load();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: number) => {
    const d = docs?.find((x) => x.id === id);
    if (!confirm(`Supprimer « ${d?.filename || 'ce document'} » ? Cette action est irréversible.`)) return;
    try {
      await deleteVaultDoc(id);
      if (selected === id) setSelected(null);
      setChecked((s) => { const n = new Set(s); n.delete(id); return n; });
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const toggleCheck = (id: number) => setChecked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const selectedDoc = docs?.find((d) => d.id === selected) || null;
  const checkedIds = Array.from(checked);

  return (
    <div className="admin-app">
      <header className="admin-header">
        <div className="admin-brand"><span className="logo">⚖</span><strong>Jurilux</strong>
          <span className="admin-tag">Vault</span></div>
        <div className="admin-tabs" />
        <div className="admin-header-actions">
          <a className="ghost small-link" href="/">← Retour à l'accueil</a>
        </div>
      </header>

      <main className="admin-main">
        <div className="tab-body">
          <p className="muted small">
            Documents privés du cabinet — déposez vos pièces, interrogez-les, comparez-les et
            confrontez-les à vos playbooks. Vos documents restent isolés de ceux des autres utilisateurs.
          </p>

          {error && <p className="warn">⚠ {error}</p>}

          {/* Dépôt */}
          <div className="panel">
            <div className="panel-title">Déposer un document</div>
            <input type="file" onChange={onUpload} disabled={uploading} />
            {uploading && <p className="muted small" style={{ marginTop: 8 }}>Dépôt et indexation en cours…</p>}
            {uploadMsg && <p className="ok-msg" style={{ marginTop: 8, marginBottom: 0 }}>{uploadMsg}</p>}
          </div>

          {/* Liste des documents */}
          <div className="panel">
            <div className="corpus-head">
              <div className="panel-title">Mes documents {docs ? `(${docs.length})` : ''}</div>
              {checkedIds.length >= 2 && (
                <button className="send" onClick={() => setShowReview(true)}>
                  Comparer en tableau ({checkedIds.length})
                </button>
              )}
            </div>
            {!docs ? <p className="muted">Chargement…</p> : docs.length === 0 ? (
              <p className="muted small">Aucun document déposé pour l'instant.</p>
            ) : (
              <div className="table-wrap">
                <table className="admin-table">
                  <thead><tr>
                    <th></th><th>Document</th><th>Statut</th><th>Chunks</th><th>Déposé</th><th></th><th></th>
                  </tr></thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d.id} className={selected === d.id ? 'hit-new' : undefined}>
                        <td>
                          <input type="checkbox" checked={checked.has(d.id)}
                            onChange={() => toggleCheck(d.id)} style={{ width: 16, height: 16 }} />
                        </td>
                        <td>{d.filename}</td>
                        <td>{statusBadge(d.status)}</td>
                        <td className="num">{d.n_chunks}</td>
                        <td className="muted nowrap">{fmtDate(d.created_at)}</td>
                        <td>
                          <button className="ghost" onClick={() => setSelected(selected === d.id ? null : d.id)}>
                            {selected === d.id ? 'Fermer' : 'Analyser'}
                          </button>
                        </td>
                        <td><button className="row-del" onClick={() => remove(d.id)}>Supprimer</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Revue tabulaire */}
          {showReview && checkedIds.length >= 2 && (
            <ReviewTable docIds={checkedIds} onClose={() => setShowReview(false)} />
          )}

          {/* Analyses du document sélectionné */}
          {selectedDoc && <AnalysisPanel doc={selectedDoc} />}

          {/* Q&A Vault */}
          <VaultAsk />

          {/* Revue de contrat + playbooks */}
          <PlaybookManager docs={docs || []} />
        </div>
      </main>

      <footer className="insight-foot">Vault — espace privé du cabinet <span className="version">{APP_VERSION}</span></footer>
    </div>
  );
}
