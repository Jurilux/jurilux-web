import { randomUUID } from 'node:crypto';
import type { Db } from '../../db.js';
import { withProvisioning, withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';

// M2 — Entités de conformité (US-2.1) : multi-tenant à deux niveaux.
// Organization = niveau facturation ; ComplianceEntity = l'entité assujettie.
// En coûts partagés, CHAQUE associé est une entité étanche (sa propre ARG,
// sa propre procédure, ses propres clients) — cloisonnement garanti par la RLS.

export type PracticeMode = 'individual' | 'integrated_association' | 'company' | 'shared_costs';

export interface CreateOrgInput {
  name: string;
  practiceMode: PracticeMode;
  // En coûts partagés : un nom d'entité par associé (≥ 2). Sinon ignoré.
  partnerEntityNames?: string[] | undefined;
}

export interface CreatedOrg {
  orgId: string;
  entities: { id: string; name: string; type: string }[];
}

export async function createOrganization(
  db: Db,
  ownerUserId: string,
  input: CreateOrgInput,
): Promise<CreatedOrg> {
  if (input.practiceMode === 'shared_costs') {
    if (!input.partnerEntityNames || input.partnerEntityNames.length < 2) {
      throw new Error('shared_costs requiert au moins deux entités associées');
    }
  }

  const entityType =
    input.practiceMode === 'individual'
      ? 'individual'
      : input.practiceMode === 'shared_costs'
        ? 'shared_cost_partner'
        : 'firm';

  const names = input.practiceMode === 'shared_costs' ? input.partnerEntityNames! : [input.name];

  // Identifiants pré-générés : posés dans le contexte RLS avant les INSERT
  // (visibilité requise par les RETURNING de Prisma — voir withProvisioning).
  const orgId = randomUUID();
  const plannedEntities = names.map((name) => ({ id: randomUUID(), name }));

  const provisioningCtx = {
    userId: ownerUserId,
    entityIds: plannedEntities.map((e) => e.id),
    orgIds: [orgId],
  };

  return withProvisioning(db, provisioningCtx, async (tx) => {
    const org = await tx.organization.create({
      data: { id: orgId, name: input.name, practiceMode: input.practiceMode },
    });

    const entities = [];
    for (const { id, name } of plannedEntities) {
      const entity = await tx.complianceEntity.create({
        data: { id, orgId: org.id, type: entityType, name },
      });
      // Le créateur devient owner de chaque entité créée ; en coûts partagés,
      // il retirera/l'on ajoutera ensuite les associés sur leurs entités respectives.
      await tx.membership.create({
        data: { userId: ownerUserId, entityId: entity.id, role: 'owner' },
      });
      await appendAudit(tx, {
        entityId: entity.id,
        actorId: ownerUserId,
        action: 'entity.created',
        objectType: 'compliance_entity',
        objectId: entity.id,
      });
      entities.push({ id: entity.id, name: entity.name, type: entity.type });
    }
    return { orgId: org.id, entities };
  });
}

export interface UserEntity {
  entityId: string;
  entityName: string;
  entityType: string;
  orgId: string;
  role: string;
}

/** Rattachements de l'utilisateur — sert à construire le contexte tenant de chaque requête. */
export async function listUserEntities(db: Db, userId: string): Promise<UserEntity[]> {
  // Le contexte minimal (app.user_id) suffit : la politique RLS `membership_read`
  // autorise la lecture de ses propres rattachements.
  const rows = await withTenantContext(
    db,
    { userId, entityIds: [], orgIds: [] },
    async (tx) => {
      const memberships = await tx.membership.findMany({ where: { userId } });
      if (memberships.length === 0) return [];
      // Deuxième passe avec le contexte complet pour lire entités + org.
      return memberships;
    },
  );
  if (rows.length === 0) return [];

  const entityIds = rows.map((m) => m.entityId);
  const entities = await withTenantContext(
    db,
    { userId, entityIds, orgIds: [] },
    (tx) => tx.complianceEntity.findMany({ where: { id: { in: entityIds } } }),
  );
  const byId = new Map(entities.map((e) => [e.id, e]));
  return rows.flatMap((m) => {
    const e = byId.get(m.entityId);
    return e
      ? [{ entityId: e.id, entityName: e.name, entityType: e.type, orgId: e.orgId, role: m.role }]
      : [];
  });
}
