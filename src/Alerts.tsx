import { useEffect, useState, FormEvent } from 'react';
import { listAlerts, createAlert, checkAlert, alertHits, deleteAlert, Alert, AlertHit } from './api';

const SOURCE_LABEL: Record<string, string> = {
  jurisprudence: 'Jurisprudence', law: 'Textes de loi', projet_loi: 'Projets de loi',
};

function hitHref(h: AlertHit): string | null {
  if (h.source_type === 'projet_loi') return h.url || null;
  if (h.source_type === 'law') return h.pdf_url || null;
  if (h.doc_id) return `/docs/${h.doc_id}.pdf`;
  return h.url || null;
}

// Tiroir « Mes alertes de veille » (V3) : suivre un sujet, être notifié in-app des nouvelles décisions.
export function Alerts({ onClose }: { onClose: () => void }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [sel, setSel] = useState<Alert | null>(null);

  const load = () => listAlerts().then(setAlerts).catch(() => setAlerts([]));
  useEffect(() => { load(); }, []);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{sel ? 'Résultats' : 'Mes alertes de veille'}</h2>
          <button className="ghost close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {sel
          ? <AlertHitsView alert={sel} onBack={() => { setSel(null); load(); }} />
          : <AlertsList alerts={alerts} onCreated={load} onOpen={setSel} />}
      </aside>
    </div>
  );
}

function AlertsList({ alerts, onCreated, onOpen }:
  { alerts: Alert[] | null; onCreated: () => void; onOpen: (a: Alert) => void }) {
  const [query, setQuery] = useState('');
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    try { await createAlert(query.trim(), src || undefined); setQuery(''); setSrc(''); onCreated(); }
    finally { setBusy(false); }
  };

  return (
    <>
      <p className="muted small">Suivez un sujet juridique. Jurilux remonte ici les décisions qui y
        correspondent — et signale les nouvelles au fil des mises à jour du corpus.</p>
      {!alerts ? <p className="muted">Chargement…</p> : alerts.length === 0 ? (
        <p className="muted small">Aucune alerte. Créez votre première veille ci-dessous.</p>
      ) : (
        <ul className="hist-list">
          {alerts.map((a) => (
            <li key={a.id}>
              <button className="hist-item" onClick={() => onOpen(a)}>
                <span className="hist-q">
                  {a.unseen > 0 && <span className="alert-badge">{a.unseen}</span>}
                  {a.query}
                </span>
                <span className="hist-meta">
                  {a.source_type ? SOURCE_LABEL[a.source_type] : 'Toutes sources'} · {a.total} résultat{a.total > 1 ? 's' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="cab-form alert-create">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Sujet à suivre (ex. harcèlement moral au travail)" />
        <select value={src} onChange={(e) => setSrc(e.target.value)}>
          <option value="">Toutes sources</option>
          <option value="jurisprudence">Jurisprudence</option>
          <option value="law">Textes de loi</option>
          <option value="projet_loi">Projets de loi</option>
        </select>
        <button className="send" type="submit" disabled={busy || query.trim().length < 2}>Suivre</button>
      </form>
    </>
  );
}

function AlertHitsView({ alert, onBack }: { alert: Alert; onBack: () => void }) {
  const [hits, setHits] = useState<AlertHit[] | null>(null);

  useEffect(() => {
    // Rafraîchir (nouveaux résultats) puis charger — l'ouverture marque comme lu côté serveur.
    checkAlert(alert.id).catch(() => {}).then(() => alertHits(alert.id).then(setHits).catch(() => setHits([])));
  }, [alert.id]);

  const remove = async () => {
    if (confirm('Supprimer cette alerte ?')) { await deleteAlert(alert.id); onBack(); }
  };

  return (
    <>
      <div className="ws-topbar">
        <button className="linklike back" onClick={onBack}>← Mes alertes</button>
        <button className="linklike ws-danger" onClick={remove}>Supprimer l'alerte</button>
      </div>
      <p className="muted small">Sujet : <b>{alert.query}</b></p>
      {!hits ? <p className="muted">Recherche…</p> : hits.length === 0 ? (
        <p className="muted small">Aucun résultat pour ce sujet pour l'instant.</p>
      ) : (
        <div className="cab-items">
          {hits.map((h) => {
            const href = hitHref(h);
            return (
              <div className={`probe-item probe-${h.source_type || 'autre'}${h.seen ? '' : ' hit-new'}`} key={h.id}>
                <div className="probe-head">
                  {!h.seen && <span className="alert-badge">nouveau</span>}
                  <span className="probe-doc mono">{h.title || h.doc_id}</span>
                  {h.year && <span className="muted">· {h.year}</span>}
                </div>
                {href && <a href={href} target="_blank" rel="noopener noreferrer" className="alert-link">Ouvrir le document</a>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
