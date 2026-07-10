// Qualification in/out scope d'un dossier (US-4.1) — module isolé, logique pure,
// table de vérité testée (test/unit/scoping.test.ts).
//
// Référence métier : art. 2-1(12) de la Loi modifiée du 12 novembre 2004 — les
// avocats sont assujettis lorsqu'ils assistent leur client dans la planification
// ou l'exécution de transactions (immobilier, gestion de fonds/actifs, comptes,
// constitution/gestion de sociétés, PSSF...) ou agissent pour son compte dans des
// transactions financières ou immobilières. Exemptions : évaluation de la
// situation juridique, défense/représentation en justice (art. 7 : dispense DOS).
//
// Le verdict et la version de l'algorithme sont enregistrés avec les réponses :
// toute re-qualification crée une révision tracée (ScopingRevision).

export const SCOPING_VERSION = '2026.1';

export type ScopingCategory =
  | 'real_estate'
  | 'company_formation'
  | 'pssf'
  | 'family_office'
  | 'tax_advice'
  | 'asset_management'
  | 'funds_of_third_parties'
  | 'litigation'
  | 'consultation'
  | 'other';

export interface ScopingAnswers {
  /** Catégorie d'activité du mandat. */
  category: ScopingCategory;
  /** Le mandat relève-t-il de la défense ou de la représentation en justice ? */
  isDefenseOrJudicialProceedings: boolean;
  /** S'agit-il d'une pure évaluation de la situation juridique (consultation), sans participation à une transaction ? */
  isPureLegalConsultation: boolean;
  /** L'avocat assiste-t-il à la planification ou à l'exécution d'une transaction, ou agit-il au nom du client ? */
  assistsInTransaction: boolean;
  /** L'avocat manie-t-il des fonds, titres ou autres actifs du client ? */
  handlesClientFunds: boolean;
}

export type Verdict = 'in_scope' | 'out_of_scope' | 'exempt_defense' | 'exempt_consultation';

export interface ScopingResult {
  verdict: Verdict;
  version: string;
  /** Motif en langage clair (affiché et archivé — opposabilité § D.0-3). */
  reason: string;
}

/** Catégories d'activité visées par l'art. 2-1(12). */
const AML_CATEGORIES: readonly ScopingCategory[] = [
  'real_estate',
  'company_formation',
  'pssf',
  'family_office',
  'tax_advice',
  'asset_management',
  'funds_of_third_parties',
];

export function qualify(answers: ScopingAnswers): ScopingResult {
  // 1. Défense / représentation en justice : exemption prioritaire.
  if (answers.isDefenseOrJudicialProceedings) {
    return {
      verdict: 'exempt_defense',
      version: SCOPING_VERSION,
      reason:
        'Mandat de défense ou de représentation en justice : hors champ des obligations de vigilance.',
    };
  }

  // 2. Maniement de fonds/actifs du client : assujettissement quelle que soit la catégorie.
  if (answers.handlesClientFunds) {
    return {
      verdict: 'in_scope',
      version: SCOPING_VERSION,
      reason: 'Maniement de fonds, titres ou actifs du client : dossier assujetti.',
    };
  }

  // 3. Activité visée + participation à la transaction : assujetti.
  if (AML_CATEGORIES.includes(answers.category) && answers.assistsInTransaction) {
    return {
      verdict: 'in_scope',
      version: SCOPING_VERSION,
      reason:
        'Assistance à la planification ou à l’exécution d’une transaction dans une activité visée par l’art. 2-1(12).',
    };
  }

  // 4. Pure consultation juridique (évaluation de la situation juridique).
  if (answers.isPureLegalConsultation) {
    return {
      verdict: 'exempt_consultation',
      version: SCOPING_VERSION,
      reason:
        'Évaluation de la situation juridique du client sans participation à une transaction : exemption consultation.',
    };
  }

  // 5. À défaut : hors champ.
  return {
    verdict: 'out_of_scope',
    version: SCOPING_VERSION,
    reason: 'Activité non visée par l’art. 2-1(12) sans maniement de fonds : hors champ.',
  };
}
