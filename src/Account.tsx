import { useEffect, useState, FormEvent } from 'react';
import {
  listApiKeys, createApiKey, revokeApiKey,
  listPrompts, createPrompt, deletePrompt,
  exportMyData, changePassword,
  ApiKey, ApiKeyCreated, Prompt,
} from './api';

// Tiroir « Mon compte / Paramètres » : clés d'API de service, bibliothèque de
// prompts, export RGPD des données personnelles, changement de mot de passe.
export function Account({ onClose }: { onClose: () => void }) {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>Mon compte</h2>
          <button className="ghost close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <ApiKeysSection />
        <PromptsSection />
        <DataSection />
        <PasswordSection />
      </aside>
    </div>
  );
}

// 1. Clés d'API de service : liste, création (clé en clair montrée une fois), révocation.
function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setError(null);
    listApiKeys().then(setKeys).catch((e) => { setKeys([]); setError(e instanceof Error ? e.message : 'Échec'); });
  };
  useEffect(load, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const k = await createApiKey(name.trim());
      setFresh(k); setCopied(false); setName(''); load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
    finally { setBusy(false); }
  };

  const revoke = async (id: number) => {
    if (!confirm('Révoquer définitivement cette clé ? Les intégrations qui l\'utilisent cesseront de fonctionner.')) return;
    try { await revokeApiKey(id); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
  };

  const copy = () => {
    if (!fresh) return;
    navigator.clipboard.writeText(fresh.key).then(() => setCopied(true)).catch(() => {});
  };

  return (
    <div className="cab-section">
      <div className="nav-label">Clés d'API</div>
      <p className="muted small">Créez des clés pour interroger Jurilux depuis vos propres outils.</p>

      {fresh && (
        <div className="ok-msg" style={{ display: 'block' }}>
          <p><strong>Voici votre clé « {fresh.name} ».</strong> Copiez-la maintenant : elle ne sera plus affichée.</p>
          <code className="mono" style={{ display: 'block', wordBreak: 'break-all', margin: '.5rem 0' }}>{fresh.key}</code>
          <div className="cab-row-actions">
            <button className="send" type="button" onClick={copy}>{copied ? '✓ Copiée' : 'Copier'}</button>
            <button className="ghost" type="button" onClick={() => setFresh(null)}>J'ai copié</button>
          </div>
        </div>
      )}

      {!keys ? <p className="muted small">Chargement…</p> : keys.length === 0 ? (
        <p className="muted small">Aucune clé pour l'instant.</p>
      ) : (
        keys.map((k) => (
          <div className="cab-row" key={k.id}>
            <span className="mono">{k.name} · {k.prefix}… · {new Date(k.created_at).toLocaleDateString('fr-FR')}</span>
            {k.revoked ? (
              <span className="plan-badge plan-student">révoquée</span>
            ) : (
              <button className="row-del" onClick={() => revoke(k.id)}>Révoquer</button>
            )}
          </div>
        ))
      )}

      <form onSubmit={create} className="cab-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la clé (ex. Intégration compta)" />
        <button className="send" type="submit" disabled={busy || !name.trim()}>Créer</button>
      </form>
      {error && <p className="warn small">⚠ {error}</p>}
    </div>
  );
}

// 2. Bibliothèque de prompts : liste (portée perso/cabinet), création (perso), suppression.
function PromptsSection() {
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    listPrompts().then(setPrompts).catch((e) => { setPrompts([]); setError(e instanceof Error ? e.message : 'Échec'); });
  };
  useEffect(load, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true); setError(null);
    try { await createPrompt(title.trim(), body.trim()); setTitle(''); setBody(''); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    if (!confirm('Supprimer ce prompt ?')) return;
    try { await deletePrompt(id); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
  };

  return (
    <div className="cab-section">
      <div className="nav-label">Bibliothèque de prompts</div>
      <p className="muted small">Enregistrez vos formulations réutilisables.</p>

      {!prompts ? <p className="muted small">Chargement…</p> : prompts.length === 0 ? (
        <p className="muted small">Aucun prompt enregistré.</p>
      ) : (
        prompts.map((p) => (
          <div className="cab-row" key={p.id}>
            <span className="mono">{p.title}
              <span className={`plan-badge plan-${p.scope === 'cabinet' ? 'pro' : 'student'}`} style={{ marginLeft: '.4rem' }}>
                {p.scope === 'cabinet' ? 'cabinet' : 'perso'}
              </span>
            </span>
            {p.scope === 'perso' && <button className="row-del" onClick={() => remove(p.id)}>Supprimer</button>}
          </div>
        ))
      )}

      <form onSubmit={create} className="cab-form" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre du prompt" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Corps du prompt…" rows={3} />
        <button className="send" type="submit" disabled={busy || !title.trim() || !body.trim()}>Ajouter</button>
      </form>
      {error && <p className="warn small">⚠ {error}</p>}
    </div>
  );
}

// 3. Mes données (RGPD) : export JSON téléchargé côté navigateur.
function DataSection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doExport = async () => {
    setBusy(true); setError(null);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mes-donnees-jurilux.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
    finally { setBusy(false); }
  };

  return (
    <div className="cab-section">
      <div className="nav-label">Mes données (RGPD)</div>
      <p className="muted small">Téléchargez une copie de vos données personnelles (compte, historique, favoris).</p>
      <button className="send" type="button" onClick={doExport} disabled={busy}>
        {busy ? 'Préparation…' : 'Exporter mes données (JSON)'}
      </button>
      {error && <p className="warn small">⚠ {error}</p>}
    </div>
  );
}

// 4. Mot de passe : ancien + nouveau (≥ 8 caractères).
function PasswordSection() {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setDone(false);
    if (newPassword.length < 8) { setError('Le nouveau mot de passe doit faire au moins 8 caractères.'); return; }
    setBusy(true);
    try {
      await changePassword(oldPassword, newPassword);
      setDone(true); setOld(''); setNew('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
    finally { setBusy(false); }
  };

  return (
    <div className="cab-section">
      <div className="nav-label">Mot de passe</div>
      <form onSubmit={submit} className="cab-form" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)}
          placeholder="Mot de passe actuel" autoComplete="current-password" />
        <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)}
          placeholder="Nouveau mot de passe (≥ 8 caractères)" autoComplete="new-password" />
        <button className="send" type="submit" disabled={busy || !oldPassword || !newPassword}>Changer</button>
      </form>
      {done && <p className="ok-msg">✓ Mot de passe modifié.</p>}
      {error && <p className="warn small">⚠ {error}</p>}
    </div>
  );
}
