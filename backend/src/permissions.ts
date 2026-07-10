// Matrice de permissions par rôle (US-1.2 / US-1.3) — deny by default.
// Toute vérification passe par can() côté serveur ; la matrice est testée unitairement
// (test/unit/permissions.test.ts) et sert d'annexe de référence pour la documentation.
//
// Rappels métier :
//  - `auditor` est strictement lecture seule.
//  - Les DOS (M7) ne sont lisibles que par `compliance` et `owner` (anti tipping-off, US-7.1).
//  - L'activation d'un dossier à risque élevé exige `compliance` ou `owner` (US-5.2).

export const ROLES = ['owner', 'lawyer', 'assistant', 'compliance', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  // M2 — entité
  'entity.settings.manage',
  'entity.members.manage',
  // M3/M4 — clients & dossiers
  'client.read',
  'client.write',
  'matter.read',
  'matter.write',
  'matter.activate_high_risk',
  // M5 — screening
  'screening.run',
  'screening.decide',
  // M7 — DOS (cloisonnée)
  'dos.create',
  'dos.read',
  'dos.decide',
  // M8 — registres
  'registry.read',
  'registry.write',
  // M9 — rapports
  'report.generate',
  'export.ccbl',
  'export.reversibility',
  // M10 — administration
  'audit.read',
  'retention.legal_hold',
] as const;
export type Action = (typeof ACTIONS)[number];

const MATRIX: Record<Action, readonly Role[]> = {
  'entity.settings.manage': ['owner', 'compliance'],
  'entity.members.manage': ['owner'],

  'client.read': ['owner', 'lawyer', 'assistant', 'compliance', 'auditor'],
  'client.write': ['owner', 'lawyer', 'assistant', 'compliance'],
  'matter.read': ['owner', 'lawyer', 'assistant', 'compliance', 'auditor'],
  'matter.write': ['owner', 'lawyer', 'assistant', 'compliance'],
  'matter.activate_high_risk': ['owner', 'compliance'],

  'screening.run': ['owner', 'lawyer', 'assistant', 'compliance'],
  'screening.decide': ['owner', 'compliance'],

  'dos.create': ['owner', 'lawyer', 'assistant', 'compliance'],
  'dos.read': ['owner', 'compliance'],
  'dos.decide': ['owner', 'compliance'],

  'registry.read': ['owner', 'lawyer', 'compliance', 'auditor'],
  'registry.write': ['owner', 'compliance'],

  'report.generate': ['owner', 'compliance'],
  'export.ccbl': ['owner', 'compliance'],
  'export.reversibility': ['owner'],

  'audit.read': ['owner', 'compliance', 'auditor'],
  'retention.legal_hold': ['owner', 'compliance'],
};

export function can(role: Role, action: Action): boolean {
  const allowed = MATRIX[action];
  return allowed !== undefined && allowed.includes(role);
}

// Vue d'ensemble exportable (documentation, écrans d'administration).
export function permissionMatrix(): Record<Action, readonly Role[]> {
  return MATRIX;
}
