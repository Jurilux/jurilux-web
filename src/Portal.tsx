// Portail client (I6, inspiration Legora Portal) : la page PUBLIQUE /p/<jeton> — le client
// du cabinet consulte SON dossier en lecture seule, sans compte. Habillée de l'identité du
// cabinet (nom + logo partagés). Le jeton 128 bits est l'autorisation ; rien d'autre du
// cabinet n'est atteignable depuis cette page.
import { useEffect, useState } from 'react';
import { renderAnswer } from './App';
import { Citation, pdfHref } from './api';

interface PortalItem { question: string; answer: string | null; citations: Citation[]; status: string | null; created_at: string; }
interface PortalData { dossier: string; cabinet: { name: string | null; logo: string | null }; items: PortalItem[]; }

export function PortalView({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/portal/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setErr('Ce lien de dossier est introuvable ou a été révoqué par le cabinet.'));
  }, [token]);

  if (err) {
    return <div className="portal"><div className="portal-card"><p className="warn">⚠ {err}</p></div></div>;
  }
  if (!data) return <div className="route-loading">Chargement du dossier…</div>;

  return (
    <div className="portal">
      <header className="portal-head">
        {data.cabinet.logo && <img className="portal-logo" src={data.cabinet.logo} alt="" />}
        <div>
          {data.cabinet.name && <div className="portal-cabinet">{data.cabinet.name}</div>}
          <h1>{data.dossier}</h1>
          <p className="muted">Dossier partagé en lecture par votre cabinet — {data.items.length} élément{data.items.length > 1 ? 's' : ''}.</p>
        </div>
      </header>

      {data.items.length === 0 && (
        <div className="portal-card"><p className="muted">Ce dossier ne contient encore aucun élément.</p></div>
      )}
      {data.items.map((it, i) => (
        <article className="portal-card" key={i}>
          <h2 className="portal-q">{it.question}</h2>
          {it.answer
            ? <div className="answer" dangerouslySetInnerHTML={{ __html: renderAnswer(it.answer, it.citations || []) }} />
            : <p className="muted">Élément sans réponse enregistrée.</p>}
          {(it.citations || []).length > 0 && (
            <div className="sources">
              <p className="sources-title">Sources · {it.citations.length}</p>
              {it.citations.map((c, j) => {
                const href = pdfHref(c) || c.url || null;
                const label = c.title || c.doc_id;
                return <div className="source" key={j}>
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>}
                </div>;
              })}
            </div>
          )}
          <p className="portal-date muted small">{new Date(it.created_at).toLocaleDateString('fr-FR')}</p>
        </article>
      ))}

      <footer className="portal-foot muted">
        Document d'information préparé par votre cabinet via Jurilux — ne constitue pas un avis
        juridique. Pour toute question, contactez votre avocat.
      </footer>
    </div>
  );
}
