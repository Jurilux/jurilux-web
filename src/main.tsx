import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Backoffice et vue partagée sont chargés à la demande (code splitting) : un visiteur
// qui vient poser une question ne télécharge pas le code de l'admin ni du partage.
const AdminApp = lazy(() => import('./Admin'));
const InsightApp = lazy(() => import('./Insight'));
const SharedView = lazy(() => import('./Shared').then((m) => ({ default: m.SharedView })));

// Routage minimal sans dépendance : /admin → backoffice, /insight → profiling avocats,
// /r/<id> → réponse partagée, sinon l'app publique. Caddy sert index.html en fallback.
const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin';
const isInsight = path === '/insight';
const shareMatch = path.match(/^\/r\/([A-Za-z0-9_-]+)$/);

const route = isAdmin ? <AdminApp />
  : isInsight ? <InsightApp />
  : shareMatch ? <SharedView id={shareMatch[1]} />
  : <App />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="route-loading">Chargement…</div>}>{route}</Suspense>
  </React.StrictMode>,
);
