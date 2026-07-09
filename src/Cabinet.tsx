import { useEffect, useState, FormEvent } from 'react';
import {
  listWorkspaces, createWorkspace, listMembers, addMember, setMemberRole, removeMember,
  deleteWorkspace, leaveWorkspace, listDossiers, createDossier, deleteDossier,
  listDossierItems, addDossierItem, restrictDossier, grantDossierAccess, revokeDossierAccess,
  createPortal, getPortal, revokePortal,
  Workspace, Member, Dossier, DossierItem, Citation,
} from './api';

// Modale « Enregistrer dans un dossier » : range une réponse sourcée dans un dossier partagé.
export function SaveToDossierModal({ item, onClose }: {
  item: { question: string; answer: string | null; citations: Citation[]; status?: string };
  onClose: () => void;
}) {
  const [spaces, setSpaces] = useState<Workspace[] | null>(null);
  const [wid, setWid] = useState<number | null>(null);
  const [dossiers, setDossiers] = useState<Dossier[] | null>(null);
  const [newName, setNewName] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listWorkspaces().then((s) => { setSpaces(s); if (s.length) setWid(s[0].id); }).catch(() => setSpaces([]));
  }, []);
  useEffect(() => { if (wid) listDossiers(wid).then(setDossiers).catch(() => setDossiers([])); }, [wid]);

  const save = async (did: number) => {
    setBusy(true); setErr(null);
    try {
      await addDossierItem(did, item.question, item.answer, item.citations, item.status);
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Échec'); } finally { setBusy(false); }
  };
  const saveNew = async (e: FormEvent) => {
    e.preventDefault();
    if (!wid || !newName.trim()) return;
    setBusy(true);
    try { const d = await createDossier(wid, newName.trim()); await save(d.id); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Enregistrer dans un dossier</h2>
          <button className="ghost close" onClick={onClose} aria-label="Fermer">✕</button></div>
        {done ? (
          <><p className="ok-msg">✓ Réponse rangée dans le dossier.</p>
            <button className="send" onClick={onClose}>Fermer</button></>
        ) : spaces && spaces.length === 0 ? (
          <p className="muted">Créez d'abord un cabinet (menu « Mon cabinet »).</p>
        ) : (
          <div className="auth-form">
            <label>Cabinet
              <select value={wid ?? ''} onChange={(e) => setWid(Number(e.target.value))}>
                {(spaces || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <div className="nav-label">Choisir un dossier</div>
            {!dossiers ? <p className="muted small">…</p> : dossiers.map((d) => (
              <button key={d.id} className="hist-item" disabled={busy} onClick={() => save(d.id)}>
                <span className="hist-q">{d.name}</span><span className="hist-meta">{d.items} réponse{d.items > 1 ? 's' : ''}</span>
              </button>
            ))}
            <form onSubmit={saveNew} className="cab-form">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="…ou nouveau dossier" />
              <button className="ghost" type="submit" disabled={busy || !newName.trim()}>Créer &amp; ranger</button>
            </form>
            {err && <p className="warn small">⚠ {err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// Tiroir « Mon cabinet » (V3) : espaces de travail, membres/rôles, dossiers de recherche partagés.

// Tiroir « Mon cabinet » (V3) : espaces de travail, membres/rôles, dossiers de recherche partagés.
export function Cabinet({ onClose }: { onClose: () => void }) {
  const [spaces, setSpaces] = useState<Workspace[] | null>(null);
  const [sel, setSel] = useState<Workspace | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSpaces = () => listWorkspaces().then(setSpaces).catch((e) => setError(e.message));
  useEffect(() => { loadSpaces(); }, []);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{dossier ? dossier.name : sel ? sel.name : 'Mon cabinet'}</h2>
          <button className="ghost close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {error && <p className="warn">⚠ {error}</p>}

        {dossier && sel ? (
          <DossierView dossier={dossier} onBack={() => setDossier(null)}
            canAdmin={sel.role === 'owner' || sel.role === 'admin'} />
        ) : sel ? (
          <WorkspaceView ws={sel} onBack={() => { setSel(null); loadSpaces(); }}
            onOpenDossier={setDossier} />
        ) : (
          <SpacesList spaces={spaces} onCreated={loadSpaces} onOpen={setSel} />
        )}
      </aside>
    </div>
  );
}

function SpacesList({ spaces, onCreated, onOpen }:
  { spaces: Workspace[] | null; onCreated: () => void; onOpen: (w: Workspace) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await createWorkspace(name.trim()); setName(''); onCreated(); } finally { setBusy(false); }
  };
  return (
    <>
      <p className="muted small">Regroupez vos recherches par cabinet et partagez des dossiers avec votre équipe.</p>
      {!spaces ? <p className="muted">Chargement…</p> : spaces.length === 0 ? (
        <p className="muted small">Aucun cabinet pour l'instant. Créez-en un ci-dessous.</p>
      ) : (
        <ul className="hist-list">
          {spaces.map((w) => (
            <li key={w.id}>
              <button className="hist-item" onClick={() => onOpen(w)}>
                <span className="hist-q">{w.name}</span>
                <span className="hist-meta">{w.role} · {w.members} membre{w.members > 1 ? 's' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="cab-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du cabinet" />
        <button className="send" type="submit" disabled={busy || !name.trim()}>Créer</button>
      </form>
    </>
  );
}

function WorkspaceView({ ws, onBack, onOpenDossier }:
  { ws: Workspace; onBack: () => void; onOpenDossier: (d: Dossier) => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [dossiers, setDossiers] = useState<Dossier[] | null>(null);
  const [email, setEmail] = useState('');
  const [dname, setDname] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const canAdmin = ws.role === 'owner' || ws.role === 'admin';

  const load = () => {
    listMembers(ws.id).then(setMembers).catch(() => setMembers([]));
    listDossiers(ws.id).then(setDossiers).catch(() => setDossiers([]));
  };
  useEffect(load, [ws.id]);

  const invite = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await addMember(ws.id, email.trim()); setEmail(''); load(); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Échec'); }
  };
  const mkDossier = async (e: FormEvent) => {
    e.preventDefault();
    if (!dname.trim()) return;
    await createDossier(ws.id, dname.trim()); setDname(''); load();
  };
  const changeRole = async (uid: number, role: string) => {
    setMsg(null);
    try { await setMemberRole(ws.id, uid, role); load(); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Échec'); }
  };
  const kick = async (uid: number) => {
    if (confirm('Retirer ce membre du cabinet ?')) { await removeMember(ws.id, uid); load(); }
  };
  const delDossier = async (id: number) => {
    if (confirm('Supprimer ce dossier et tout son contenu ?')) { await deleteDossier(id); load(); }
  };
  const wsAction = async () => {
    if (ws.role === 'owner') {
      if (confirm('Supprimer définitivement ce cabinet (membres, dossiers, contenu) ?')) {
        await deleteWorkspace(ws.id); onBack();
      }
    } else if (confirm('Quitter ce cabinet ?')) { await leaveWorkspace(ws.id); onBack(); }
  };

  return (
    <>
      <div className="ws-topbar">
        <button className="linklike back" onClick={onBack}>← Mes cabinets</button>
        <button className="linklike ws-danger" onClick={wsAction}>
          {ws.role === 'owner' ? 'Supprimer le cabinet' : 'Quitter'}
        </button>
      </div>

      <div className="cab-section">
        <div className="nav-label">Membres</div>
        {!members ? <p className="muted small">…</p> : members.map((m) => (
          <div className="cab-row" key={m.user_id}>
            <span className="mono">{m.email}</span>
            {canAdmin && m.role !== 'owner' ? (
              <span className="cab-row-actions">
                <select className="cell-select" value={m.role}
                  onChange={(e) => changeRole(m.user_id, e.target.value)}>
                  <option value="member">membre</option>
                  <option value="admin">admin</option>
                </select>
                <button className="row-del" onClick={() => kick(m.user_id)}>Retirer</button>
              </span>
            ) : (
              <span className={`plan-badge plan-${m.role === 'member' ? 'student' : 'pro'}`}>{m.role}</span>
            )}
          </div>
        ))}
        {canAdmin && (
          <form onSubmit={invite} className="cab-form">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="email d'un membre inscrit" />
            <button className="ghost" type="submit">Inviter</button>
          </form>
        )}
        {msg && <p className="warn small">⚠ {msg}</p>}
      </div>

      <div className="cab-section">
        <div className="nav-label">Dossiers de recherche</div>
        {!dossiers ? <p className="muted small">…</p> : dossiers.length === 0 ? (
          <p className="muted small">Aucun dossier. Créez-en un pour y ranger des réponses.</p>
        ) : (
          <ul className="hist-list">
            {dossiers.map((d) => (
              <li key={d.id}>
                <div className="dossier-li">
                  <button className="hist-item" onClick={() => onOpenDossier(d)}>
                    <span className="hist-q">{d.restricted ? '🔒 ' : ''}{d.name}</span>
                    <span className="hist-meta">{d.items} réponse{d.items > 1 ? 's' : ''}
                      {d.restricted ? ' · restreint' : ''}</span>
                  </button>
                  {canAdmin && <button className="dossier-del" title="Supprimer le dossier"
                    onClick={() => delDossier(d.id)}>✕</button>}
                </div>
                {canAdmin && (
                  <DossierRestrictControls dossier={d} members={members} onChanged={load} />
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={mkDossier} className="cab-form">
          <input value={dname} onChange={(e) => setDname(e.target.value)} placeholder="Nouveau dossier (ex. Affaire Durand)" />
          <button className="ghost" type="submit">Créer</button>
        </form>
      </div>
    </>
  );
}

// Cloison déontologique : un owner/admin peut restreindre un dossier (conflits d'intérêts)
// puis accorder/révoquer nominativement l'accès des membres du cabinet.
function DossierRestrictControls({ dossier, members, onChanged }:
  { dossier: Dossier; members: Member[] | null; onChanged: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true); setMsg(null);
    try { await restrictDossier(dossier.id, !dossier.restricted); onChanged(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Échec'); }
    finally { setBusy(false); }
  };
  const grant = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setMsg(null);
    try { await grantDossierAccess(dossier.id, email.trim()); setEmail(''); setMsg('✓ Accès accordé.'); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Échec'); }
    finally { setBusy(false); }
  };
  const revoke = async (uid: number) => {
    setBusy(true); setMsg(null);
    try { await revokeDossierAccess(dossier.id, uid); setMsg('✓ Accès révoqué.'); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Échec'); }
    finally { setBusy(false); }
  };

  return (
    <div className="dossier-restrict">
      <div className="cab-row">
        <span className="muted small">
          {dossier.restricted
            ? '🔒 Dossier restreint : visible seulement des administrateurs de l\'espace et des membres explicitement autorisés (conflits d\'intérêts).'
            : 'Dossier ouvert : visible de tous les membres du cabinet.'}
        </span>
        <button className="ghost small" disabled={busy} onClick={toggle}>
          {dossier.restricted ? 'Ouvrir à tous' : 'Restreindre'}
        </button>
      </div>
      {dossier.restricted && (
        <>
          <form onSubmit={grant} className="cab-form">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="Autoriser un membre (email)" />
            <button className="ghost" type="submit" disabled={busy || !email.trim()}>Autoriser</button>
          </form>
          {members && members.some((m) => m.role === 'member') && (
            <>
              <p className="muted small">Révoquer l'accès d'un membre du cabinet :</p>
              {members.filter((m) => m.role === 'member').map((m) => (
                <div className="cab-row" key={m.user_id}>
                  <span className="mono small">{m.email}</span>
                  <button className="row-del" disabled={busy}
                    onClick={() => revoke(m.user_id)}>Révoquer</button>
                </div>
              ))}
            </>
          )}
        </>
      )}
      {msg && <p className="warn small">{msg}</p>}
    </div>
  );
}

function DossierView({ dossier, onBack, canAdmin }: { dossier: Dossier; onBack: () => void; canAdmin?: boolean }) {
  const [items, setItems] = useState<DossierItem[] | null>(null);
  useEffect(() => { listDossierItems(dossier.id).then(setItems).catch(() => setItems([])); }, [dossier.id]);
  // Portail client : lien de lecture pour le client final (owner/admin, hors dossier restreint).
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [portalErr, setPortalErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (canAdmin) getPortal(dossier.id).then((p) => setPortalUrl(p.url)).catch(() => {});
  }, [dossier.id, canAdmin]);
  const partager = async () => {
    setPortalErr(null);
    try { setPortalUrl((await createPortal(dossier.id)).url); }
    catch (e) { setPortalErr(e instanceof Error ? e.message : 'Création du portail impossible.'); }
  };
  const revoquer = async () => {
    try { await revokePortal(dossier.id); setPortalUrl(null); } catch { /* déjà révoqué */ }
  };
  const copier = async () => {
    if (!portalUrl) return;
    try { await navigator.clipboard.writeText(window.location.origin + portalUrl);
      setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* silencieux */ }
  };
  return (
    <>
      <button className="linklike back" onClick={onBack}>← Dossiers</button>

      {canAdmin && (
        <div className="portal-manage">
          <div className="nav-label">Portail client</div>
          {portalUrl ? (
            <div className="portal-manage-row">
              <code className="portal-link" title={portalUrl}>{portalUrl}</code>
              <button className="ghost" onClick={copier}>{copied ? '✓ Copié' : 'Copier le lien'}</button>
              <button className="ghost" onClick={partager} title="Un nouveau lien révoque l'ancien">Régénérer</button>
              <button className="ghost draft-danger" onClick={revoquer}>Révoquer</button>
            </div>
          ) : (
            <div className="portal-manage-row">
              <p className="muted small" style={{ margin: 0 }}>
                Partagez ce dossier en LECTURE à votre client (sans compte) — lien révocable.</p>
              <button className="ghost" onClick={partager}>Créer le lien client</button>
            </div>
          )}
          {portalErr && <p className="warn small">⚠ {portalErr}</p>}
        </div>
      )}
      {!items ? <p className="muted">Chargement…</p> : items.length === 0 ? (
        <p className="muted small">Ce dossier est vide. Depuis une réponse, utilisez « Enregistrer » pour l'y ranger.</p>
      ) : (
        <div className="cab-items">
          {items.map((it) => (
            <div className="cab-item" key={it.id}>
              <div className="cab-item-q">{it.question}</div>
              {it.answer && <div className="cab-item-a">{it.answer.replace(/[#*]/g, '').slice(0, 200)}…</div>}
              <div className="cab-item-meta">{it.citations.length} source{it.citations.length > 1 ? 's' : ''}
                {it.added_by && <> · {it.added_by}</>}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
