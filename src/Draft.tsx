// Rédaction assistée v2 — un vrai atelier de rédaction :
//   · MODÈLES : intégrés (mise en demeure, avis, conclusions, courrier, note),
//     personnels ou partagés au cabinet, avec variables {{cle}} en formulaire ;
//   · BROUILLONS persistants (réouverture), VERSIONS (chaque génération, raffinage
//     ou édition manuelle est archivée, restaurable) ;
//   · RAFFINEMENT itératif (« ajoute un paragraphe sur… ») fondé sur le corpus ;
//   · ton / longueur, copie, impression PDF, enregistrer la trame comme modèle.
// Tout est sourcé sur le corpus officiel — brouillon à relire par un avocat.
import { useEffect, useMemo, useState } from 'react';
import {
  pdfHref, listWorkspaces, Workspace, Citation,
  redactionModeles, redactionCreerModele, redactionSupprimerModele,
  redactionBrouillons, redactionBrouillon, redactionGenerer, redactionPatch,
  redactionRaffiner, redactionSupprimer,
  ModeleIntegre, ModeleUtilisateur, Brouillon, BrouillonResume, VariableModele,
} from './api';
import { renderAnswer } from './App';

type Choix =
  | { type: 'libre' }
  | { type: 'integre'; m: ModeleIntegre }
  | { type: 'perso'; m: ModeleUtilisateur };

// Exemples prêts à l'emploi : pré-remplissent modèle + variables + instruction (l'avocat
// n'a plus qu'à lancer la rédaction), pour montrer d'emblée ce que le module sait faire.
interface Exemple {
  kind: string; titre: string; modele: string; ton?: string;
  variables: Record<string, string>; instruction: string;
}
const EXEMPLES: Exemple[] = [
  { kind: 'Mise en demeure', titre: 'Loyers commerciaux impayés', modele: 'mise-en-demeure', ton: 'ferme',
    variables: { destinataire: 'SARL Bail Center, 4 rue de la Gare, L-1611 Luxembourg',
      objet: 'loyers commerciaux impayés de mars à juin', montant: '18 600 €', delai: '15 jours' },
    instruction: 'Rédige une mise en demeure pour loyers commerciaux impayés depuis mars, rappelant les obligations du preneur et réservant la résiliation du bail.' },
  { kind: 'Avis juridique', titre: "Validité d'un préavis de licenciement", modele: 'avis-juridique',
    variables: { question: 'Le préavis de licenciement de 2 mois est-il valable ?',
      contexte: "Salarié en CDI, 8 ans d'ancienneté, licencié avec un préavis de 2 mois." },
    instruction: "Analyse la validité d'un préavis de licenciement de 2 mois pour un salarié de 8 ans d'ancienneté en droit du travail luxembourgeois." },
  { kind: 'Conclusions', titre: 'Licenciement abusif (tribunal du travail)', modele: 'conclusions',
    variables: { juridiction: 'Tribunal du travail de Luxembourg', partie: 'Madame X, demanderesse',
      pretentions: 'licenciement abusif, 25 000 € de dommages et intérêts' },
    instruction: 'Rédige une trame de conclusions pour un licenciement abusif devant le tribunal du travail.' },
  { kind: 'Courrier client', titre: 'Contestation d’une facture de travaux', modele: 'courrier-client', ton: 'pedagogique',
    variables: { situation: "contestation d'une facture de travaux jugée excessive" },
    instruction: 'Explique au client, de façon accessible, ses droits face à une facture de travaux contestée.' },
  { kind: 'Note de recherche', titre: 'Clause de non-concurrence', modele: 'note-interne',
    variables: { sujet: "validité et portée d'une clause de non-concurrence" },
    instruction: 'Synthétise l’état du droit luxembourgeois sur la validité des clauses de non-concurrence.' },
];

const TONS = [
  { v: '', l: 'Ton : automatique' },
  { v: 'neutre', l: 'Ton : neutre' },
  { v: 'ferme', l: 'Ton : ferme' },
  { v: 'pedagogique', l: 'Ton : pédagogique' },
];
const LONGUEURS = [
  { v: '', l: 'Longueur : standard' },
  { v: 'courte', l: 'Longueur : courte' },
  { v: 'detaillee', l: 'Longueur : détaillée' },
];

export function DraftEmbedded() {
  // catalogue
  const [integres, setIntegres] = useState<ModeleIntegre[]>([]);
  const [persos, setPersos] = useState<ModeleUtilisateur[]>([]);
  const [brouillons, setBrouillons] = useState<BrouillonResume[]>([]);
  const [espaces, setEspaces] = useState<Workspace[]>([]);
  // formulaire
  const [choix, setChoix] = useState<Choix>({ type: 'libre' });
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [instruction, setInstruction] = useState('');
  const [ton, setTon] = useState('');
  const [longueur, setLongueur] = useState('');
  // document courant
  const [draft, setDraft] = useState<Brouillon | null>(null);
  const [refusMsg, setRefusMsg] = useState<string | null>(null);
  const [raffinage, setRaffinage] = useState('');
  const [busy, setBusy] = useState<'' | 'generer' | 'raffiner' | 'charger'>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // « enregistrer comme modèle »
  const [tplForm, setTplForm] = useState<{ name: string; workspace_id: string } | null>(null);

  const chargerCatalogue = () => {
    redactionModeles().then((d) => { setIntegres(d.integres); setPersos(d.modeles); }).catch(() => {});
    redactionBrouillons().then(setBrouillons).catch(() => {});
    listWorkspaces().then(setEspaces).catch(() => {});
  };
  useEffect(chargerCatalogue, []);

  const varsModele: VariableModele[] = useMemo(() => (
    choix.type === 'integre' ? choix.m.variables :
    choix.type === 'perso' ? (choix.m.variables || []) : []
  ), [choix]);

  const choisir = (val: string) => {
    setVariables({});
    if (val === 'libre') return setChoix({ type: 'libre' });
    if (val.startsWith('i:')) {
      const m = integres.find((x) => x.slug === val.slice(2));
      if (m) setChoix({ type: 'integre', m });
    } else if (val.startsWith('t:')) {
      const m = persos.find((x) => x.id === Number(val.slice(2)));
      if (m) setChoix({ type: 'perso', m });
    }
  };

  const generer = async () => {
    if (!instruction.trim() || busy) return;
    setBusy('generer'); setError(null); setRefusMsg(null); setCopied(false);
    try {
      const res = await redactionGenerer({
        instruction: instruction.trim(),
        modele: choix.type === 'integre' ? choix.m.slug : undefined,
        template_id: choix.type === 'perso' ? choix.m.id : undefined,
        variables, ton: ton || undefined, longueur: longueur || undefined,
      });
      if (res.refused || !res.draft) setRefusMsg(res.answer || 'Aucun fondement trouvé — précisez votre demande.');
      else { setDraft(res.draft); redactionBrouillons().then(setBrouillons).catch(() => {}); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La rédaction a échoué, réessayez.');
    } finally { setBusy(''); }
  };

  const raffiner = async () => {
    if (!draft || !raffinage.trim() || busy) return;
    setBusy('raffiner'); setError(null);
    try {
      const res = await redactionRaffiner(draft.id, raffinage.trim());
      if (res.refused) setError('Raffinage indisponible pour le moment — réessayez.');
      else { setDraft(res.draft); setRaffinage(''); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Le raffinage a échoué.');
    } finally { setBusy(''); }
  };

  const ouvrir = async (id: number) => {
    setBusy('charger'); setError(null); setRefusMsg(null);
    try { setDraft(await redactionBrouillon(id)); }
    catch { setError('Impossible d’ouvrir ce brouillon.'); }
    finally { setBusy(''); }
  };

  const renommer = async (title: string) => {
    if (!draft || title.trim() === draft.title) return;
    try {
      setDraft(await redactionPatch(draft.id, { title: title.trim() || 'Sans titre' }));
      redactionBrouillons().then(setBrouillons).catch(() => {});
    } catch { /* silencieux : le titre local reste */ }
  };

  const restaurer = async (content: string) => {
    if (!draft) return;
    try { setDraft(await redactionPatch(draft.id, { content })); }
    catch { setError('Restauration impossible.'); }
  };

  const supprimer = async () => {
    if (!draft || !window.confirm('Supprimer ce brouillon et tout son historique ?')) return;
    try {
      await redactionSupprimer(draft.id);
      setDraft(null);
      redactionBrouillons().then(setBrouillons).catch(() => {});
    } catch { setError('Suppression impossible.'); }
  };

  const copier = async () => {
    if (!draft) return;
    try { await navigator.clipboard.writeText(draft.content); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* silencieux */ }
  };

  const imprimer = () => {
    if (!draft) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
      <title>${draft.title.replace(/</g, '&lt;')}</title>
      <style>body{font:13.5px/1.6 Georgia,serif;color:#1c1b18;max-width:760px;margin:30px auto;padding:0 24px}
      h1,h2,h3{font-family:Georgia,serif} .foot{margin-top:28px;border-top:1px solid #ccc;padding-top:8px;
      color:#777;font-size:11px}</style></head><body>
      ${renderAnswer(draft.content, draft.citations || [])}
      <div class="foot">Brouillon assisté Jurilux — à relire par un avocat.</div></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const enregistrerModele = async () => {
    if (!tplForm || !draft) return;
    try {
      await redactionCreerModele(
        tplForm.name || draft.title, draft.content, undefined, [],
        tplForm.workspace_id ? Number(tplForm.workspace_id) : undefined);
      setTplForm(null);
      chargerCatalogue();
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
  };

  const supprimerModele = async (id: number) => {
    try { await redactionSupprimerModele(id); setChoix({ type: 'libre' }); chargerCatalogue(); }
    catch { setError('Suppression du modèle impossible.'); }
  };

  const lancerExemple = (ex: Exemple) => {
    const m = integres.find((x) => x.slug === ex.modele);
    if (m) setChoix({ type: 'integre', m });
    setVariables(ex.variables);
    setInstruction(ex.instruction);
    setTon(ex.ton || '');
    setDraft(null); setRefusMsg(null); setError(null);
  };

  return (
    <div className="draft-embedded">
      <header className="draft-head">
        <h1>Rédaction assistée</h1>
        {brouillons.length > 0 && (
          <select className="draft-open" value="" title="Rouvrir un brouillon"
            onChange={(e) => { if (e.target.value) ouvrir(Number(e.target.value)); }}>
            <option value="">Mes brouillons ({brouillons.length})…</option>
            {brouillons.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title.slice(0, 60)} · v{b.versions}
              </option>
            ))}
          </select>
        )}
      </header>

      <div className="draft-body">
        <div className="draft-grid">
          {/* ---- colonne réglages ---- */}
          <div className="draft-setup">
            <label className="draft-label">Modèle
              <select value={choix.type === 'libre' ? 'libre' : choix.type === 'integre' ? `i:${choix.m.slug}` : `t:${choix.m.id}`}
                onChange={(e) => choisir(e.target.value)}>
                <option value="libre">Rédaction libre (sans modèle)</option>
                <optgroup label="Modèles intégrés">
                  {integres.map((m) => <option key={m.slug} value={`i:${m.slug}`}>{m.name}</option>)}
                </optgroup>
                {persos.length > 0 && (
                  <optgroup label="Mes modèles & cabinet">
                    {persos.map((m) => (
                      <option key={m.id} value={`t:${m.id}`}>
                        {m.name}{m.scope === 'cabinet' ? ' · cabinet' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {choix.type === 'integre' && <p className="muted small">{choix.m.description}</p>}
            {choix.type === 'perso' && choix.m.scope === 'perso' && (
              <button className="linklike small draft-del-tpl" onClick={() => supprimerModele(choix.m.id)}>
                Supprimer ce modèle
              </button>
            )}

            {varsModele.length > 0 && (
              <div className="draft-vars">
                {varsModele.map((v) => (
                  <label key={v.cle} className="draft-label">{v.libelle}
                    <input value={variables[v.cle] || ''} placeholder={v.exemple || ''}
                      onChange={(e) => setVariables({ ...variables, [v.cle]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}

            <label className="draft-label">Instruction
              <textarea value={instruction} rows={4} disabled={busy === 'generer'}
                placeholder="Ex. Mise en demeure pour loyers impayés depuis mars, bail commercial"
                onChange={(e) => setInstruction(e.target.value)} />
            </label>

            <div className="draft-style">
              <select value={ton} onChange={(e) => setTon(e.target.value)}>
                {TONS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <select value={longueur} onChange={(e) => setLongueur(e.target.value)}>
                {LONGUEURS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
              </select>
            </div>

            <button className="send" onClick={generer} disabled={!!busy || !instruction.trim()}>
              {busy === 'generer' ? 'Rédaction en cours…' : draft ? 'Rédiger un nouveau document' : 'Rédiger'}
            </button>
            {error && <p className="warn small">⚠ {error}</p>}
            {refusMsg && <p className="muted small">{refusMsg}</p>}
            <p className="muted small">Document fondé sur le corpus officiel — à relire par un avocat.</p>
          </div>

          {/* ---- colonne document ---- */}
          <div className="draft-doc-col">
            {!draft && (
              <div className="draft-exemples">
                <h3>Exemples — cliquez pour pré-remplir</h3>
                <p className="muted small">Un modèle, ses variables et une instruction sont chargés ; il ne reste qu'à cliquer « Rédiger ».</p>
                <div className="draft-ex-grid">
                  {EXEMPLES.map((ex) => (
                    <button key={ex.titre} className="draft-ex" onClick={() => lancerExemple(ex)}>
                      <span className="draft-ex-kind">{ex.kind}</span>
                      <span className="draft-ex-title">{ex.titre}</span>
                      <span className="draft-ex-desc muted">{ex.instruction}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {draft && (
              <>
                <input className="draft-title" defaultValue={draft.title} key={draft.id}
                  onBlur={(e) => renommer(e.target.value)} title="Renommer le brouillon" />
                <div className="draft-doc answer"
                  dangerouslySetInnerHTML={{ __html: renderAnswer(draft.content, draft.citations || []) }} />

                {draft.citations.length > 0 && (
                  <div className="sources">
                    <p className="sources-title">Fondements · {draft.citations.length} document{draft.citations.length > 1 ? 's' : ''}</p>
                    {draft.citations.map((c: Citation, i: number) => {
                      const href = pdfHref(c);
                      const label = c.title || c.doc_id;
                      return (
                        <div className="source" key={`${c.doc_id}-${i}`}>
                          {href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>
                            : c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer">{label}</a>
                            : <span>{label}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="draft-refine">
                  <input value={raffinage} disabled={busy === 'raffiner'}
                    placeholder="Raffiner : « ajoute un paragraphe sur les intérêts de retard »…"
                    onChange={(e) => setRaffinage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') raffiner(); }} />
                  <button className="send" onClick={raffiner} disabled={!!busy || !raffinage.trim()}>
                    {busy === 'raffiner' ? '…' : 'Raffiner'}
                  </button>
                </div>

                <div className="draft-actions">
                  <button className="ghost" onClick={copier}>{copied ? '✓ Copié' : 'Copier'}</button>
                  <button className="ghost" onClick={imprimer}>Imprimer / PDF</button>
                  <button className="ghost" onClick={() => setTplForm({ name: draft.title, workspace_id: '' })}>
                    Enregistrer comme modèle
                  </button>
                  <button className="ghost draft-danger" onClick={supprimer}>Supprimer</button>
                </div>

                {tplForm && (
                  <div className="draft-tplform">
                    <input value={tplForm.name} placeholder="Nom du modèle"
                      onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} />
                    <select value={tplForm.workspace_id}
                      onChange={(e) => setTplForm({ ...tplForm, workspace_id: e.target.value })}>
                      <option value="">Personnel</option>
                      {espaces.map((w) => <option key={w.id} value={w.id}>Cabinet : {w.name}</option>)}
                    </select>
                    <button className="send" onClick={enregistrerModele}>Enregistrer</button>
                    <button className="ghost" onClick={() => setTplForm(null)}>Annuler</button>
                  </div>
                )}

                {draft.versions.length > 1 && (
                  <details className="draft-versions">
                    <summary>Historique — {draft.versions.length} versions</summary>
                    <ul>
                      {draft.versions.map((v, i) => (
                        <li key={v.id}>
                          <span className="muted">{new Date(v.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          {' '}· {v.motif || 'version'}
                          {i > 0 && (
                            <button className="linklike small" onClick={() => restaurer(v.content)}>restaurer</button>
                          )}
                          {i === 0 && <span className="muted small"> (courante)</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
