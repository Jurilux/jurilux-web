import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthGate } from './AuthGate';
import './styles.css';

// Backoffice et vue partagée sont chargés à la demande (code splitting) : un visiteur
// qui vient poser une question ne télécharge pas le code de l'admin ni du partage.
const AdminApp = lazy(() => import('./Admin'));
const VaultApp = lazy(() => import('./Vault'));
const SharedView = lazy(() => import('./Shared').then((m) => ({ default: m.SharedView })));

// Routage minimal sans dépendance : /admin → backoffice, /insight → profiling avocats,
// /vault → documents privés, /redaction → atelier de rédaction, /r/<id> → réponse partagée.
// Caddy sert index.html en fallback.
const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin';
const isInsight = path === '/insight';
const isVault = path === '/vault';
const isRedaction = path === '/redaction';
const shareMatch = path.match(/^\/r\/([A-Za-z0-9_-]+)$/);

// /insight rend l'APP avec le volet Insight ouvert (vue interne — plus de page à part).
const route = isAdmin ? <AdminApp />
  : isInsight ? <App initialInsight />
  : isRedaction ? <App initialRedaction />
  : isVault ? <VaultApp />
  : shareMatch ? <SharedView id={shareMatch[1]} />
  : <App />;

// Tout le site est privé : AuthGate impose une connexion avant de rendre le moindre écran.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="route-loading">Chargement…</div>}>
      <AuthGate>{route}</AuthGate>
    </Suspense>
  </React.StrictMode>,
);
