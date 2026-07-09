// Accueil « Aujourd'hui » (LOT 3 ergonomie) — le champ vide devient un tableau de bord :
// nouveautés de veille, reprise du travail, volumétrie du corpus. Tout est cliquable, rien
// n'est décoratif. Aucun nouveau backend : alertes + historique + corpus déjà exposés.
import { useEffect, useState } from 'react';
import { listAlerts, getHistory, Alert, HistoryItem, Corpus, Me } from './api';
import { RECETTES, lancerRecetteRedaction } from './recettes';

export function Today({ account, corpusInfo, alertUnseen, onOpenAlerts, onResume, onAsk }: {
  account: Me | null;
  corpusInfo: Corpus | null;
  alertUnseen: number;
  onOpenAlerts: () => void;
  onResume: (q: string) => void;
  onAsk: (q: string) => void;
}) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  useEffect(() => {
    listAlerts().then(setAlerts).catch(() => setAlerts([]));
    getHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  const jour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const veille = (alerts || []).filter((a) => a.unseen > 0).slice(0, 4);
  const recent = (history || []).slice(0, 4);
  const rem = account?.quota.remaining ?? 0;
  const quotaTxt = account?.plan === 'student' && account.quota.limit != null
    ? `${rem} question${rem > 1 ? 's' : ''} restante${rem > 1 ? 's' : ''}`
    : 'accès illimité';

  return (
    <section className="today">
      <div className="today-head">
        <h2>Bonjour — {jour}</h2>
        <p className="muted">Votre journée juridique en un coup d'œil.</p>
      </div>

      <div className="today-tiles">
        <button className="today-tile is-link" onClick={onOpenAlerts} title="Voir mes alertes">
          <b className={alertUnseen > 0 ? 'accentue' : ''}>{alertUnseen}</b>
          <span>nouveauté{alertUnseen > 1 ? 's' : ''} sur vos alertes</span>
        </button>
        <div className="today-tile">
          <b>{corpusInfo?.decisions != null ? corpusInfo.decisions.toLocaleString('fr-FR') : '—'}</b>
          <span>décisions au corpus</span>
        </div>
        <div className="today-tile">
          <b>{history ? history.length : '—'}</b>
          <span>question{history && history.length > 1 ? 's' : ''} dans votre historique</span>
        </div>
        <div className="today-tile">
          <b>{account?.plan === 'pro' ? 'Pro' : 'Étudiant'}</b>
          <span>{quotaTxt}</span>
        </div>
      </div>

      {/* Recettes prêtes à l'emploi : briques existantes packagées par domaine (1 clic). */}
      <div className="today-card today-recettes">
        <h3>Recettes prêtes à l'emploi</h3>
        <div className="recette-grid">
          {RECETTES.map((r) => (
            <button key={r.titre} className="recette" title={r.desc}
              onClick={() => {
                if (r.action.type === 'ask') onAsk(r.action.q);
                else if (r.action.type === 'redaction') lancerRecetteRedaction(r.action);
                else window.location.href = '/vault';
              }}>
              <span className="recette-dom">{r.domaine}</span>
              <span className="recette-titre">{r.titre}</span>
              <span className="recette-desc">{r.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="today-cards">
        <div className="today-card">
          <h3>Veille — nouveautés</h3>
          {alerts === null ? <p className="muted small">Chargement…</p>
            : veille.length === 0 ? <p className="muted small">Aucune nouvelle décision sur vos sujets suivis.</p>
            : veille.map((a) => (
              <button key={a.id} className="today-line" onClick={onOpenAlerts}>
                <span className="today-line-txt">{a.query}</span>
                <span className="badge-fresh">{a.unseen} nouveau{a.unseen > 1 ? 'x' : ''}</span>
              </button>
            ))}
        </div>
        <div className="today-card">
          <h3>Reprendre le travail</h3>
          {history === null ? <p className="muted small">Chargement…</p>
            : recent.length === 0 ? <p className="muted small">Vos recherches récentes apparaîtront ici.</p>
            : recent.map((h) => (
              <button key={h.id} className="today-line" onClick={() => onResume(h.question)}>
                <span className="today-line-txt">{h.question}</span>
                <span className="muted small today-line-date">{new Date(h.created_at).toLocaleDateString('fr-FR')}</span>
              </button>
            ))}
        </div>
      </div>
    </section>
  );
}
