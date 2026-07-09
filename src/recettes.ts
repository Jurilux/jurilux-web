// Recettes prêtes à l'emploi (inspiration « 500 agents » Harvey / « 300 workflows » Lexis,
// version Jurilux) : le PACKAGING de briques déjà livrées — une question type lancée telle
// quelle, un atelier de rédaction pré-rempli, ou une chaîne d'analyses Vault — rangé par
// domaine de droit. Zéro nouveau moteur : de l'assemblage.
export type RecetteAction =
  | { type: 'ask'; q: string }
  | { type: 'redaction'; modele: string; ton?: string; variables: Record<string, string>; instruction: string }
  | { type: 'vault' };

export interface Recette { domaine: string; titre: string; desc: string; action: RecetteAction; }

export const RECETTES: Recette[] = [
  // ── Bail / logement ──
  { domaine: 'Bail', titre: 'Résiliation de bail commercial',
    desc: 'État du droit sourcé : conditions et procédure de résiliation.',
    action: { type: 'ask', q: 'À quelles conditions un bail commercial peut-il être résilié pour loyers impayés ?' } },
  { domaine: 'Bail', titre: 'Mise en demeure — loyers impayés',
    desc: 'Courrier prêt à personnaliser, fondé sur le corpus, ton ferme.',
    action: { type: 'redaction', modele: 'mise-en-demeure', ton: 'ferme',
      variables: { objet: 'loyers impayés', delai: '15 jours' },
      instruction: 'Rédige une mise en demeure pour loyers impayés, rappelant les obligations du preneur et réservant la résiliation du bail.' } },
  // ── Droit du travail ──
  { domaine: 'Travail', titre: 'Licenciement avec effet immédiat',
    desc: 'Faute grave : conditions, procédure, délais, sanctions.',
    action: { type: 'ask', q: 'Quelles sont les conditions du licenciement avec effet immédiat pour faute grave ?' } },
  { domaine: 'Travail', titre: 'Avis — validité d’un préavis',
    desc: 'Avis juridique structuré (question, règles, application, conclusion).',
    action: { type: 'redaction', modele: 'avis-juridique',
      variables: { question: 'Le préavis notifié est-il valable ?' },
      instruction: 'Analyse la validité du préavis de licenciement au regard du droit du travail luxembourgeois.' } },
  { domaine: 'Travail', titre: 'Analyser des conclusions adverses',
    desc: 'Déposez le document au Vault : citations vérifiées → contre-argumentaire → résumé.',
    action: { type: 'vault' } },
  // ── Sociétés / commercial ──
  { domaine: 'Sociétés', titre: 'Responsabilité du dirigeant',
    desc: 'Jurisprudence récente sur la responsabilité des administrateurs.',
    action: { type: 'ask', q: 'Quand la responsabilité personnelle d’un administrateur de société peut-elle être engagée ?' } },
  { domaine: 'Sociétés', titre: 'Note de recherche — clause de non-concurrence',
    desc: 'Synthèse pour le dossier : état du droit, décisions clés, risques.',
    action: { type: 'redaction', modele: 'note-interne',
      variables: { sujet: 'validité et portée d’une clause de non-concurrence' },
      instruction: 'Synthétise l’état du droit luxembourgeois sur la validité des clauses de non-concurrence.' } },
  // ── Famille ──
  { domaine: 'Famille', titre: 'Pension alimentaire — critères',
    desc: 'Fixation et révision : ce que retient la jurisprudence.',
    action: { type: 'ask', q: 'Quels critères la jurisprudence retient-elle pour fixer une pension alimentaire ?' } },
];

// Pré-remplissage de l'atelier de rédaction via sessionStorage (consommé une fois au montage).
export const RECETTE_KEY = 'jx_recette_redaction';
export function lancerRecetteRedaction(a: Extract<RecetteAction, { type: 'redaction' }>) {
  sessionStorage.setItem(RECETTE_KEY, JSON.stringify(a));
  window.location.href = '/redaction';
}
