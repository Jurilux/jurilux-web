import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminApp from './Admin';
import './styles.css';

// Routage minimal sans dépendance : /admin → backoffice, sinon l'app publique.
// Caddy sert index.html en fallback (try_files) donc /admin charge bien ce bundle.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin ? <AdminApp /> : <App />}
  </React.StrictMode>,
);
