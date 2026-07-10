import type { RiskMatrix } from '../../config/screening.js';

// Moteur de scoring déclaratif (US-5.1) — logique pure : la matrice (JSON) définit
// facteurs, pondérations et seuils ; le code n'évalue que des drapeaux.
// US-5.2 : les facteurs `forced` (PEP, pays GAFI noire / UE haut risque, hit
// sanctions non levé) imposent le risque élevé et ne sont pas désactivables.

export type TriggerFlags = Record<string, boolean>;

export interface TriggeredFactor {
  id: string;
  axis: string;
  label: string;
  points?: number | undefined;
  forced?: 'high' | undefined;
}

export interface RiskResult {
  score: number;
  level: 'low' | 'medium' | 'high';
  matrixVersion: string;
  factors: TriggeredFactor[];
}

export function computeRisk(matrix: RiskMatrix, flags: TriggerFlags): RiskResult {
  const triggered: TriggeredFactor[] = [];
  let score = 0;
  let forcedHigh = false;

  for (const factor of matrix.factors) {
    if (!flags[factor.trigger]) continue;
    triggered.push({
      id: factor.id,
      axis: factor.axis,
      label: factor.label,
      points: factor.points,
      forced: factor.forced,
    });
    if (factor.forced === 'high') forcedHigh = true;
    else if (factor.points) score += factor.points;
  }

  const level = forcedHigh
    ? 'high'
    : score >= matrix.thresholds.high
      ? 'high'
      : score >= matrix.thresholds.medium
        ? 'medium'
        : 'low';

  return { score, level, matrixVersion: matrix.version, factors: triggered };
}
