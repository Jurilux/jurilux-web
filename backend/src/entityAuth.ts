import type { Db, TenantContext } from './db.js';
import { withTenantContext } from './db.js';
import { can, type Action, type Role } from './permissions.js';
import { forbidden } from './errors.js';

// Garde d'accès par entité : vérifie le rattachement de l'utilisateur à l'entité
// ET la permission du rôle (deny by default, US-1.3), puis construit le contexte
// tenant restreint à CETTE entité — la RLS fait ensuite le reste.

export interface EntityAccess {
  ctx: TenantContext;
  role: Role;
}

export async function requireEntityAction(
  db: Db,
  userId: string,
  entityId: string,
  action: Action,
): Promise<EntityAccess> {
  const membership = await withTenantContext(
    db,
    { userId, entityIds: [], orgIds: [] },
    (tx) => tx.membership.findUnique({ where: { userId_entityId: { userId, entityId } } }),
  );
  if (!membership) throw forbidden('aucun rattachement à cette entité');
  const role = membership.role as Role;
  if (!can(role, action)) throw forbidden(`le rôle ${role} ne permet pas ${action}`);
  return { ctx: { userId, entityIds: [entityId], orgIds: [] }, role };
}
