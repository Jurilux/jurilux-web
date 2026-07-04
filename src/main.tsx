import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminApp from './Admin';
import { SharedView } from './Shared';
import './styles.css';

// Routage minimal sans dépendance : /admin → backoffice, /r/<id> → réponse partagée,
// sinon l'app publique. Caddy sert index.html en fallback (try_files).
const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin';
const shareMatch = path.match(/^\/r\/([A-Za-z0-9_-]+)$/);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin ? <AdminApp /> : shareMatch ? <SharedView id={shareMatch[1]} /> : <App />}
  </React.StrictMode>,
);
