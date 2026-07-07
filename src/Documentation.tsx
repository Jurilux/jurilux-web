// Page « Documentation » du backoffice : guide utilisateur (fonctionnel) + documentation
// technique, avec diagramme d'architecture et aperçus annotés. Autonome (pas d'appel API).
import { useState } from 'react';

// ---------- petits blocs réutilisables ----------
// Cadre « fenêtre » qui présente une capture d'écran RÉELLE (src) ou, à défaut, une maquette.
function Shot({ title, src, children, legend }: {
  title: string; src?: string; children?: React.ReactNode; legend?: { n: number; t: string }[];
}) {
  return (
    <figure className="doc-shot">
      <div className="doc-shot-bar">
        <span className="doc-dot" /><span className="doc-dot" /><span className="doc-dot" />
        <span className="doc-shot-title">{title}</span>
      </div>
      <div className="doc-shot-body">
        {src ? <img className="doc-shot-img" src={src} alt={title} loading="lazy" /> : children}
      </div>
      {legend && (
        <figcaption className="doc-legend">
          {legend.map((l) => (
            <span key={l.n}><span className="doc-callout sm">{l.n}</span> {l.t}</span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return <li className="doc-step"><span className="doc-step-n">{n}</span><div>{children}</div></li>;
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="doc-section"><h2>{title}</h2>{children}</section>;
}

// ---------- diagramme d'architecture (SVG autonome) ----------
function ArchiDiagram() {
  const box = (x: number, y: number, w: number, h: number, label: string, sub: string, cls: string) => (
    <g className={cls}>
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" className="d-title">{label}</text>
      <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" className="d-sub">{sub}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 760 320" className="doc-archi" role="img" aria-label="Architecture Jurilux">
      {box(20, 130, 130, 60, 'Caddy', 'VPS OVH · UE', 'd-edge')}
      {box(210, 130, 150, 60, 'FastAPI', 'app/main.py · uvicorn', 'd-core')}
      {box(470, 30, 130, 54, 'Meilisearch', 'index chunks', 'd-dep')}
      {box(470, 110, 130, 54, 'Ollama', 'embeddings BGE-M3', 'd-dep')}
      {box(470, 190, 130, 54, 'LLM', 'Claude · Mistral · local', 'd-dep')}
      {box(470, 262, 130, 46, 'Vault index', 'vault_chunks (isolé)', 'd-vault')}
      {box(210, 232, 150, 46, 'SQLite', 'comptes · vault · audit', 'd-store')}
      {/* flèches */}
      <g className="d-arrow">
        <line x1={150} y1={160} x2={210} y2={160} />
        <line x1={360} y1={150} x2={470} y2={57} />
        <line x1={360} y1={160} x2={470} y2={137} />
        <line x1={360} y1={170} x2={470} y2={217} />
        <line x1={360} y1={180} x2={470} y2={285} />
        <line x1={285} y1={190} x2={285} y2={232} />
      </g>
      <text x={85} y={120} textAnchor="middle" className="d-note">/api/* · /health</text>
      <text x={85} y={210} textAnchor="middle" className="d-note">/docs/* → PDFs</text>
    </svg>
  );
}

// ---------- table des matières ----------
const TOC: { id: string; label: string; kind: 'u' | 't' }[] = [
  { id: 'apercu', label: "Vue d'ensemble", kind: 'u' },
  { id: 'recherche', label: 'Recherche sourcée', kind: 'u' },
  { id: 'vault', label: 'Vault — documents privés', kind: 'u' },
  { id: 'redaction', label: 'Rédaction assistée', kind: 'u' },
  { id: 'cabinet', label: 'Cabinet & cloisons', kind: 'u' },
  { id: 'veille', label: 'Veille — alertes', kind: 'u' },
  { id: 'insight', label: 'Insight & analytics', kind: 'u' },
  { id: 'compte', label: 'Mon compte', kind: 'u' },
  { id: 'archi', label: 'Architecture', kind: 't' },
  { id: 'souverainete', label: 'Souveraineté / routeur LLM', kind: 't' },
  { id: 'api', label: "Contrat d'API", kind: 't' },
  { id: 'donnees', label: 'Modèle de données', kind: 't' },
  { id: 'deploiement', label: 'Déploiement & air-gap', kind: 't' },
  { id: 'securite', label: 'Sécurité & conformité', kind: 't' },
];

const ENDPOINTS: [string, string, string][] = [
  ['POST', '/api/ask', 'Question sourcée (answer, citations, suggested_question, follow_ups)'],
  ['POST', '/api/ask/stream', 'Version streamée (SSE)'],
  ['POST', '/api/vault/documents', 'Dépôt d\'un document privé (isolé par owner_id)'],
  ['POST', '/api/vault/ask', 'Q&A Vault (isolé ; include_corpus = hybride)'],
  ['POST', '/api/vault/documents/{id}/analyze', 'citations · extract · summary · counter · timeline'],
  ['POST', '/api/vault/review', 'Revue tabulaire (1 doc = 1 ligne)'],
  ['POST', '/api/vault/documents/{id}/review-contract', 'Revue de contrat contre un playbook'],
  ['POST', '/api/draft', 'Rédaction assistée sourcée'],
  ['GET', '/api/insight/analytics', 'Analytics contentieux (public)'],
  ['GET/POST', '/api/workspaces · /api/dossiers', 'Cabinet : espaces, membres, dossiers'],
  ['POST', '/api/dossiers/{id}/restrict', 'Cloison déontologique (dossier restreint)'],
  ['GET/POST', '/api/alerts', 'Veille : alertes de nouvelle jurisprudence'],
  ['GET', '/api/admin/health · /api/admin/audit', 'Backoffice : santé, audit'],
  ['GET/PATCH', '/api/admin/config', 'Paramétrage runtime (liste blanche)'],
  ['POST/GET/DELETE', '/api/keys', 'Clés d\'API de service (X-API-Key)'],
];

const TABLES: [string, string][] = [
  ['users · sessions', 'Comptes (pbkdf2) + jetons de session hachés'],
  ['history · feedback · shares', 'Historique, retours, permaliens'],
  ['workspaces · dossiers · dossier_access', 'Cabinet + cloisons déontologiques'],
  ['alerts · alert_hits', 'Veille in-app'],
  ['vault_documents', 'Métadonnées des documents privés (isolés owner_id)'],
  ['insight_appearances', 'Profiling avocats (heuristique, jamais de magistrats)'],
  ['api_keys · prompts · playbooks', 'Clés de service, prompts, règles de contrats'],
  ['audit_log · app_config', 'Journal souverain + réglages runtime'],
];

export default function Documentation() {
  const [openTech, setOpenTech] = useState(true);
  return (
    <div className="doc">
      <header className="doc-hero">
        <div>
          <p className="doc-kicker">Documentation &amp; guide</p>
          <h1>Prendre en main Jurilux</h1>
          <p className="doc-lead">
            Assistant juridique luxembourgeois : posez une question en langage naturel, obtenez
            une réponse <strong>sourcée et vérifiable</strong>. Ce guide couvre l'usage
            (côté avocat) puis le fonctionnement technique (côté équipe).
          </p>
        </div>
      </header>

      <nav className="doc-toc" aria-label="Sommaire">
        <div className="doc-toc-col">
          <span className="doc-toc-h">Guide utilisateur</span>
          {TOC.filter((t) => t.kind === 'u').map((t) => <a key={t.id} href={`#${t.id}`}>{t.label}</a>)}
        </div>
        <div className="doc-toc-col">
          <span className="doc-toc-h">Documentation technique</span>
          {TOC.filter((t) => t.kind === 't').map((t) => <a key={t.id} href={`#${t.id}`}>{t.label}</a>)}
        </div>
      </nav>

      {/* ============ GUIDE UTILISATEUR ============ */}
      <Section id="apercu" title="Vue d'ensemble">
        <div className="doc-cards">
          {[['🔎', 'Sourcé', 'Chaque affirmation cite sa source (jurisprudence ou Legilux), ouvrable en PDF.'],
            ['🛡️', 'Refus > invention', "Le modèle n'invente jamais de droit : sans extrait pertinent, il le dit."],
            ['🇪🇺', 'Souverain', 'Hébergé UE ; routage LLM par sensibilité (Claude / Mistral UE / local air-gap).'],
            ['🔒', 'Confidentiel', 'Vos documents (Vault) restent isolés par compte ; option 100 % sur site.']]
            .map(([i, t, d]) => (
              <div key={t} className="doc-card"><span className="doc-card-i">{i}</span>
                <strong>{t}</strong><p>{d}</p></div>
            ))}
        </div>
      </Section>

      <Section id="recherche" title="1 · Recherche sourcée">
        <p>Le cœur du produit. Posez une question précise ; la réponse cite ses sources.</p>
        <ol className="doc-steps">
          <Step n={1}>Saisissez une question <em>précise</em> (« Quel préavis pour un licenciement au Luxembourg ? »).</Step>
          <Step n={2}>Affinez si besoin via les <strong>filtres</strong> (année, juridiction, type de source).</Step>
          <Step n={3}>Lisez la réponse ; cliquez une <strong>citation</strong> pour ouvrir le PDF de la décision.</Step>
          <Step n={4}>Suivez le <strong>parcours guidé</strong> (questions de suivi) ou testez un <strong>autre angle</strong>.</Step>
          <Step n={5}>Partagez (permalien) ou <strong>rangez</strong> la réponse dans un dossier du cabinet.</Step>
        </ol>
        <Shot title="jurilux.lu — Recherche" src="/guide/recherche.png"
          legend={[{ n: 1, t: 'Réponse sourcée + citations cliquables (→ PDF)' },
                   { n: 2, t: 'Parcours guidé : questions de suivi' },
                   { n: 3, t: 'Autre angle + retour d\'avis (👍/👎)' }]} />
      </Section>

      <Section id="vault" title="2 · Vault — documents privés du cabinet">
        <p>Déposez vos propres pièces (conclusions, contrats, décisions) et interrogez-les.
          <strong> Isolation stricte</strong> : un utilisateur n'atteint jamais les documents d'un autre.</p>
        <ol className="doc-steps">
          <Step n={1}>Menu → <strong>🔒 Vault</strong>. Déposez un PDF ou un texte.</Step>
          <Step n={2}>Lancez une <strong>analyse</strong> : vérification des citations (ancrée au corpus officiel),
            extraction structurée, résumé, contre-argumentaire, chronologie.</Step>
          <Step n={3}><strong>Q&amp;A</strong> sur vos documents ; cochez « inclure le corpus public » pour une réponse
            <strong> hybride</strong> (vos pièces + jurisprudence officielle).</Step>
          <Step n={4}><strong>Revue tabulaire</strong> : comparez plusieurs documents (1 doc = 1 ligne).</Step>
          <Step n={5}><strong>Revue de contrat</strong> : appliquez un <em>playbook</em> de règles → verdict par règle.</Step>
        </ol>
        <Shot title="/vault — Documents privés & analyses" src="/guide/vault.png"
          legend={[{ n: 1, t: 'Dépôt + liste des documents (isolés par compte)' },
                   { n: 2, t: 'Analyses : citations, extraction, résumé, contre-argumentaire, chronologie' },
                   { n: 3, t: 'Interrogation isolée ou hybride ; revue de contrat par playbook' }]} />
      </Section>

      <Section id="redaction" title="3 · Rédaction assistée">
        <p>Menu → <strong>✍️ Rédiger</strong>. Décrivez le document voulu ; Jurilux produit un
          brouillon <strong>fondé sur le corpus officiel</strong>, avec citations.</p>
        <Shot title="Rédiger — brouillon sourcé" src="/guide/rediger.png"
          legend={[{ n: 1, t: 'Instruction en langage naturel' }, { n: 2, t: 'Brouillon fondé sur le corpus (à relire par un avocat)' }]} />
      </Section>

      <Section id="cabinet" title="4 · Cabinet & cloisons déontologiques">
        <p>Créez des <strong>espaces</strong> (cabinet/équipe), invitez des membres (rôles owner/admin/membre),
          rangez les réponses dans des <strong>dossiers partagés</strong>.</p>
        <ol className="doc-steps">
          <Step n={1}>Menu → <strong>🗂️ Mon cabinet</strong> → créez un espace, ajoutez des membres.</Step>
          <Step n={2}>Un dossier sensible peut être <strong>restreint 🔒</strong> (cloison déontologique) :
            invisible sauf pour les administrateurs de l'espace et les membres <em>explicitement autorisés</em>.</Step>
        </ol>
        <Shot title="Mon cabinet — membres & dossiers" src="/guide/cabinet.png"
          legend={[{ n: 1, t: 'Membres du cabinet et leurs rôles' },
                   { n: 2, t: 'Dossiers partagés ; un dossier restreint reste invisible aux non-autorisés' }]} />
      </Section>

      <Section id="veille" title="5 · Veille — alertes">
        <p>Menu → <strong>🔔 Mes alertes</strong>. Enregistrez un sujet ; Jurilux remonte les
          nouvelles décisions correspondantes (badge non-lus). Le contrôle tourne aussi au cron d'ingestion.</p>
        <Shot title="Mes alertes" src="/guide/alertes.png"
          legend={[{ n: 1, t: 'Sujets suivis' }, { n: 2, t: '« Vérifier » relance et remonte les nouveautés' }]} />
      </Section>

      <Section id="insight" title="6 · Insight & analytics contentieux">
        <p>Onglet public <strong>Insight</strong> : profils d'<strong>avocats</strong> (jamais de magistrats)
          issus de la jurisprudence publique, et <strong>analytics</strong> (volumes + taux de succès estimé
          par matière / juridiction / année).</p>
        <Shot title="/insight — Fiche avocat" src="/guide/insight.png"
          legend={[{ n: 1, t: 'Profil d\'un avocat (jamais de magistrat) — décisions publiques' },
                   { n: 2, t: 'Issue estimée, confrères, activité par année/juridiction' }]} />
      </Section>

      <Section id="compte" title="7 · Mon compte">
        <p>Menu → <strong>⚙️ Mon compte</strong> : <strong>clés d'API</strong> (intégrations, en-tête
          <code>X-API-Key</code>), <strong>bibliothèque de prompts</strong> (perso/cabinet),
          <strong>export RGPD</strong> (téléchargement de toutes vos données), mot de passe.
          Le <strong>SSO du cabinet</strong> (OIDC) s'affiche à la connexion s'il est configuré.</p>
        <Shot title="Mon compte" src="/guide/compte.png"
          legend={[{ n: 1, t: 'Clés d\'API de service' }, { n: 2, t: 'Prompts, export RGPD, mot de passe' }]} />
      </Section>

      {/* ============ DOCUMENTATION TECHNIQUE ============ */}
      <div className="doc-tech-head">
        <h2>Documentation technique</h2>
        <button className="ghost" onClick={() => setOpenTech((v) => !v)}>{openTech ? 'Réduire' : 'Déplier'}</button>
      </div>
      {openTech && (<>
        <Section id="archi" title="Architecture">
          <p>FastAPI (routes <em>inline</em>) derrière Caddy ; Meilisearch pour la recherche, Ollama pour les
            embeddings, un routeur LLM (Claude / Mistral / local). Persistance <strong>SQLite brut</strong>
            (pas d'ORM) ; le Vault indexe ses chunks dans un index Meili séparé, isolé par <code>owner_id</code>.</p>
          <ArchiDiagram />
        </Section>

        <Section id="souverainete" title="Souveraineté — routeur de modèle par sensibilité">
          <p>Le fournisseur LLM est choisi selon la <strong>sensibilité</strong> de la requête, pas par clause :</p>
          <table className="doc-table">
            <thead><tr><th>Sensibilité</th><th>Source</th><th>Réglage</th></tr></thead>
            <tbody>
              <tr><td><span className="mk-badge ok">public</span></td><td>Corpus jurisprudence / Legilux</td><td><code>LLM_PROVIDER_PUBLIC</code></td></tr>
              <tr><td><span className="mk-badge warn">confidentiel</span></td><td>Documents privés du Vault</td><td><code>LLM_PROVIDER_CONFIDENTIAL</code></td></tr>
            </tbody>
          </table>
          <p className="doc-note">Fournisseurs : <code>anthropic</code> (Claude) · <code>mistral</code> (UE) ·
            <code>local</code> (Ollama, air-gap). Par défaut tout sur Anthropic (comportement historique).</p>
        </Section>

        <Section id="api" title="Contrat d'API (extraits)">
          <table className="doc-table doc-api">
            <thead><tr><th>Méthode</th><th>Chemin</th><th>Rôle</th></tr></thead>
            <tbody>{ENDPOINTS.map(([m, p, d]) => (
              <tr key={p}><td><span className="mk-badge m">{m}</span></td><td><code>{p}</code></td><td>{d}</td></tr>
            ))}</tbody>
          </table>
          <p className="doc-note">Contrat verrouillé côté front (<code>src/api.ts</code>) ; seuls des ajouts
            optionnels rétrocompatibles. Auth : <code>Authorization: Bearer &lt;token&gt;</code> (sessions pbkdf2).</p>
        </Section>

        <Section id="donnees" title="Modèle de données (SQLite)">
          <table className="doc-table">
            <thead><tr><th>Tables</th><th>Rôle</th></tr></thead>
            <tbody>{TABLES.map(([t, d]) => <tr key={t}><td><code>{t}</code></td><td>{d}</td></tr>)}</tbody>
          </table>
        </Section>

        <Section id="deploiement" title="Déploiement & air-gap">
          <ul className="doc-ul">
            <li><strong>Cloud UE (défaut)</strong> : Docker Compose (Meili + Ollama + API) sur VPS OVH, Caddy en façade.</li>
            <li><strong>Air-gap</strong> : router le LLM en <code>local</code> (Ollama), couper l'egress — aucune donnée ne sort.</li>
            <li><strong>Chiffrement au repos</strong> : volume LUKS + sauvegardes chiffrées (<code>scripts/backup.sh</code>).</li>
            <li><strong>Rollback</strong> : images taguées <code>vX.Y.Z</code> ; gate <code>pytest</code> avant déploiement.</li>
          </ul>
        </Section>

        <Section id="securite" title="Sécurité & conformité">
          <div className="doc-cards">
            {[['Audit', 'Journal local qui/quoi/quand (login, mutations admin, Vault). GET /api/admin/audit.'],
              ['RGPD', 'Export (portabilité) + purge/rétention configurable. Minimisation.'],
              ['Isolation', 'Vault filtré par owner_id ; cloisons déontologiques sur les dossiers.'],
              ['Refus > invention', 'Prompt anti-hallucination ; citations vérifiables ancrées au corpus.']]
              .map(([t, d]) => <div key={t} className="doc-card"><strong>{t}</strong><p>{d}</p></div>)}
          </div>
        </Section>
      </>)}

      <footer className="doc-foot">
        Référentiel : <code>CLAUDE.md</code> (architecture) · <code>POSITIONING.md</code> ·
        <code>ROADMAP.md</code> · <code>functional/</code> (tests de parcours). Guide interne — mise à jour à chaque évolution.
      </footer>
    </div>
  );
}
