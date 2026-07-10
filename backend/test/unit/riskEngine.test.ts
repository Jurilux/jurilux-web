import { describe, expect, it } from 'vitest';
import { computeRisk } from '../../src/modules/risk/engine.js';
import { defaultRiskMatrix } from '../../src/config/screening.js';

// Moteur de scoring déclaratif (US-5.1/5.2) contre la matrice par défaut (Annexe 1).

const matrix = defaultRiskMatrix();

describe('moteur de scoring', () => {
  it('aucun facteur → risque faible, score 0', () => {
    const r = computeRisk(matrix, {});
    expect(r.level).toBe('low');
    expect(r.score).toBe(0);
    expect(r.factors).toEqual([]);
  });

  it('PEP → risque élevé FORCÉ quel que soit le score (US-5.2)', () => {
    const r = computeRisk(matrix, { pep_present: true });
    expect(r.level).toBe('high');
    expect(r.factors.some((f) => f.forced === 'high')).toBe(true);
  });

  it('hit sanctions non levé → élevé forcé', () => {
    expect(computeRisk(matrix, { open_sanctions_hit: true }).level).toBe('high');
  });

  it('pays GAFI noire / UE haut risque → élevé forcé ; grise → points', () => {
    expect(computeRisk(matrix, { country_gafi_black: true }).level).toBe('high');
    expect(computeRisk(matrix, { country_eu_high_risk: true }).level).toBe('high');
    const grey = computeRisk(matrix, { country_gafi_grey: true });
    expect(grey.level).toBe('low');
    expect(grey.score).toBe(3);
  });

  it('cumul de points : seuils moyen (≥4) et élevé (≥8) de l’Annexe 1', () => {
    // immobilier (+2) + relation à distance (+2 canal, +2 client) = 6 → moyen
    const medium = computeRisk(matrix, {
      category_real_estate: true,
      remote_relationship: true,
    });
    expect(medium.score).toBe(6);
    expect(medium.level).toBe('medium');

    // + PSSF (+3) → 9 ≥ 8 → élevé sans facteur forcé
    const high = computeRisk(matrix, {
      category_real_estate: true,
      remote_relationship: true,
      category_pssf: true,
    });
    expect(high.score).toBe(9);
    expect(high.level).toBe('high');
    expect(high.factors.every((f) => f.forced === undefined)).toBe(true);
  });

  it('l’instantané contient version de matrice et facteurs déclenchés (reproductibilité)', () => {
    const r = computeRisk(matrix, { category_pssf: true, third_party_introducer: true });
    expect(r.matrixVersion).toBe(matrix.version);
    expect(r.factors.map((f) => f.id).sort()).toEqual(['introducer', 'pssf']);
  });
});
