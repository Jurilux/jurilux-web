import { describe, expect, it } from 'vitest';
import { SCOPING_VERSION, qualify, type ScopingAnswers } from '../../src/modules/matters/scoping.js';

// Table de vérité du module de qualification (US-4.1) — la logique est isolée
// et pure : chaque combinaison significative est énumérée ici.

const base: ScopingAnswers = {
  category: 'other',
  isDefenseOrJudicialProceedings: false,
  isPureLegalConsultation: false,
  assistsInTransaction: false,
  handlesClientFunds: false,
};

describe('qualification in/out scope (art. 2-1(12))', () => {
  it('défense/représentation en justice : exemption prioritaire sur tout le reste', () => {
    expect(
      qualify({
        ...base,
        isDefenseOrJudicialProceedings: true,
        category: 'real_estate',
        assistsInTransaction: true,
        handlesClientFunds: true,
      }).verdict,
    ).toBe('exempt_defense');
  });

  it('maniement de fonds du client : toujours in scope (hors défense)', () => {
    expect(qualify({ ...base, handlesClientFunds: true }).verdict).toBe('in_scope');
    expect(
      qualify({ ...base, category: 'litigation', handlesClientFunds: true }).verdict,
    ).toBe('in_scope');
  });

  it('activité visée + assistance à la transaction : in scope', () => {
    for (const category of [
      'real_estate',
      'company_formation',
      'pssf',
      'family_office',
      'tax_advice',
      'asset_management',
      'funds_of_third_parties',
    ] as const) {
      expect(qualify({ ...base, category, assistsInTransaction: true }).verdict, category).toBe(
        'in_scope',
      );
    }
  });

  it('activité visée SANS assistance à la transaction : pas in scope par ce seul motif', () => {
    expect(qualify({ ...base, category: 'real_estate' }).verdict).toBe('out_of_scope');
    expect(
      qualify({ ...base, category: 'tax_advice', isPureLegalConsultation: true }).verdict,
    ).toBe('exempt_consultation');
  });

  it('activité non visée : hors champ même avec assistance à la transaction', () => {
    for (const category of ['litigation', 'consultation', 'other'] as const) {
      expect(qualify({ ...base, category, assistsInTransaction: true }).verdict, category).toBe(
        'out_of_scope',
      );
    }
  });

  it('pure consultation juridique : exemption consultation', () => {
    expect(qualify({ ...base, isPureLegalConsultation: true }).verdict).toBe('exempt_consultation');
  });

  it('chaque verdict porte la version de l’algorithme et un motif en langage clair', () => {
    const result = qualify(base);
    expect(result.version).toBe(SCOPING_VERSION);
    expect(result.reason.length).toBeGreaterThan(10);
  });
});
