import { describe, expect, it } from 'vitest';
import { ACTIONS, ROLES, can, permissionMatrix } from '../../src/permissions.js';

describe('matrice de permissions (US-1.3)', () => {
  it('refuse par défaut : toute action inconnue est refusée pour tous les rôles', () => {
    for (const role of ROLES) {
      // @ts-expect-error action volontairement hors matrice
      expect(can(role, 'action.inexistante')).toBe(false);
    }
  });

  it('auditor est strictement lecture seule', () => {
    const writes = ACTIONS.filter(
      (a) =>
        a.endsWith('.write') ||
        a.endsWith('.manage') ||
        a.endsWith('.decide') ||
        a.endsWith('.create') ||
        a === 'matter.activate_high_risk' ||
        a === 'screening.run' ||
        a === 'report.generate' ||
        a === 'export.ccbl' ||
        a === 'export.reversibility' ||
        a === 'retention.legal_hold',
    );
    for (const action of writes) {
      expect(can('auditor', action), `auditor ne doit pas pouvoir ${action}`).toBe(false);
    }
    expect(can('auditor', 'client.read')).toBe(true);
    expect(can('auditor', 'audit.read')).toBe(true);
  });

  it('DOS : lisible et décidable uniquement par compliance et owner (anti tipping-off, US-7.1)', () => {
    for (const role of ROLES) {
      const allowed = role === 'owner' || role === 'compliance';
      expect(can(role, 'dos.read'), role).toBe(allowed);
      expect(can(role, 'dos.decide'), role).toBe(allowed);
    }
    // ... mais tout lawyer/assistant peut créer un signalement interne.
    expect(can('lawyer', 'dos.create')).toBe(true);
    expect(can('assistant', 'dos.create')).toBe(true);
    expect(can('auditor', 'dos.create')).toBe(false);
  });

  it("l'activation d'un dossier à risque élevé exige compliance ou owner (US-5.2)", () => {
    expect(can('owner', 'matter.activate_high_risk')).toBe(true);
    expect(can('compliance', 'matter.activate_high_risk')).toBe(true);
    expect(can('lawyer', 'matter.activate_high_risk')).toBe(false);
    expect(can('assistant', 'matter.activate_high_risk')).toBe(false);
  });

  it("l'export de réversibilité est réservé à l'owner (US-10.3)", () => {
    for (const role of ROLES) {
      expect(can(role, 'export.reversibility')).toBe(role === 'owner');
    }
  });

  it('la matrice ne référence que des rôles connus', () => {
    for (const [action, roles] of Object.entries(permissionMatrix())) {
      for (const role of roles) {
        expect(ROLES, `${action} référence un rôle inconnu: ${role}`).toContain(role);
      }
    }
  });
});
