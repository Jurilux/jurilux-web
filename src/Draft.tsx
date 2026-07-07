import { useState } from 'react';
import { draft, pdfHref, Citation } from './api';

// Tiroir « Rédaction assistée » : produit un brouillon sourcé (mise en demeure,
// courrier, clause…) fondé sur le corpus juridique luxembourgeois, à relire par un avocat.
export function Draft({ onClose }: { onClose: () => void }) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { answer: string | null; refused: boolean; citations: Citation[] } | null
  >(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true); setError(null); setResult(null); setCopied(false);
    try {
      const res = await draft(instruction.trim());
      setResult(res);
    } catch {
      // 503 / panne : refus gracieux côté UI.
      setError('La rédaction a échoué, réessayez.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result?.answer) return;
    try {
      await navigator.clipboard.writeText(result.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silencieux */ }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Rédaction assistée</h2>
          <button className="ghost close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <p className="muted small">
          Décrivez le document à rédiger. Le brouillon sera fondé sur le droit luxembourgeois.
        </p>

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Ex. Rédige une mise en demeure pour loyers impayés, fondée sur le droit LU"
          rows={4}
          style={{ width: '100%', resize: 'vertical' }}
          disabled={busy}
        />

        <button className="send" onClick={run} disabled={busy || !instruction.trim()}>
          {busy ? 'Rédaction en cours…' : 'Rédiger'}
        </button>

        {error && <p className="warn small">⚠ {error}</p>}

        {result && (
          result.refused ? (
            <p className="muted">Aucun fondement trouvé, précisez votre demande.</p>
          ) : (
            <div className="draft-result">
              <div className="draft-actions" style={{ display: 'flex', justifyContent: 'flex-end', margin: '0.5rem 0' }}>
                <button className="ghost" onClick={copy} disabled={!result.answer}>
                  {copied ? '✓ Copié' : 'Copier'}
                </button>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{result.answer}</div>

              {result.citations.length > 0 && (
                <div className="sources">
                  <p className="sources-title">
                    Fondements · {result.citations.length} document{result.citations.length > 1 ? 's' : ''}
                  </p>
                  {result.citations.map((c, i) => {
                    const href = pdfHref(c);
                    const label = c.title || c.doc_id;
                    return (
                      <div className="source" key={`${c.doc_id}-${i}`}>
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>
                        ) : c.url ? (
                          <a href={c.url} target="_blank" rel="noopener noreferrer">{label}</a>
                        ) : (
                          <span>{label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}

        <p className="muted small" style={{ marginTop: '1rem' }}>
          Brouillon assisté — à relire par un avocat.
        </p>
      </div>
    </div>
  );
}
