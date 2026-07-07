// Mur d'authentification GLOBAL : tout le site est privé. Tant que l'utilisateur n'est pas
// connecté, aucun écran de l'app n'est rendu — seulement l'écran de connexion / inscription.
// (Verrouillage côté front ; l'inscription reste ouverte — « mur de login » classique.)
import { useEffect, useState, FormEvent } from 'react';
import { getToken, me, login, register, oidcEnabled, oidcLogin, captureOidcToken } from './api';

function LoginWall({ onIn }: { onIn: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState(false);
  useEffect(() => { oidcEnabled().then(setSso).catch(() => {}); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await (mode === 'login' ? login : register)(email.trim(), password);
      onIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la connexion');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="authwall">
      <div className="authwall-card">
        <div className="authwall-brand"><span className="authwall-mark">⚖</span> <strong>Jurilux</strong></div>
        <p className="authwall-lead">
          Assistant juridique luxembourgeois — <strong>accès réservé</strong>.<br />
          {mode === 'login' ? 'Connectez-vous pour continuer.' : 'Créez votre compte pour continuer.'}
        </p>
        <form onSubmit={submit} className="auth-form">
          <label>E-mail
            <input type="email" required autoFocus autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.lu" />
          </label>
          <label>Mot de passe
            <input type="password" required value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)} placeholder="8 caractères minimum" />
          </label>
          {error && <p className="warn">⚠ {error}</p>}
          <button className="send" type="submit" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>
        {sso && (
          <button className="ghost sso-btn" style={{ width: '100%', marginTop: 10 }} onClick={oidcLogin}>
            🏛️ Se connecter via le SSO du cabinet
          </button>
        )}
        <p className="muted authwall-switch">
          {mode === 'login' ? "Pas encore de compte ? " : 'Déjà un compte ? '}
          <button className="linklike" type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
            {mode === 'login' ? 'Créer un compte' : 'Se connecter'}
          </button>
        </p>
      </div>
      <p className="authwall-foot muted">Les réponses ne constituent pas un avis juridique.</p>
    </div>
  );
}

// Portillon : « checking » (vérification du jeton) → « in » (app) ou « out » (mur de login).
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');
  useEffect(() => {
    captureOidcToken();   // retour SSO : le jeton est placé en fragment #token=…
    if (!getToken()) { setState('out'); return; }
    me().then((a) => setState(a ? 'in' : 'out')).catch(() => setState('out'));
  }, []);
  if (state === 'checking') return <div className="route-loading">Chargement…</div>;
  if (state === 'out') return <LoginWall onIn={() => setState('in')} />;
  return <>{children}</>;
}
