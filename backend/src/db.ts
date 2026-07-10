import { PrismaClient, Prisma } from '../generated/prisma/index.js';

// Le client Prisma se connecte avec un utilisateur membre du rôle `lexkyc_app`
// (non propriétaire, soumis à la RLS). Le cloisonnement par entité est garanti
// à DEUX niveaux : contrôles applicatifs (permissions.ts) ET politiques RLS
// PostgreSQL alimentées par les GUC posées ici via SET LOCAL (§ D.5-3).

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export function createDb(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export interface TenantContext {
  userId: string;
  entityIds: string[];
  orgIds: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuids(ids: string[]): void {
  for (const id of ids) {
    if (!UUID_RE.test(id)) throw new Error(`identifiant invalide: ${id}`);
  }
}

async function setConfig(tx: Tx, key: string, value: string): Promise<void> {
  // set_config(..., true) => portée transaction (SET LOCAL), paramétré côté serveur.
  await tx.$queryRaw`SELECT set_config(${key}, ${value}, true)`;
}

/**
 * Exécute `fn` dans une transaction porteuse du contexte tenant de l'utilisateur.
 * Toutes les requêtes métier DOIVENT passer par ici : hors contexte, la RLS ne
 * renvoie aucune ligne.
 */
export async function withTenantContext<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertUuids([ctx.userId, ...ctx.entityIds, ...ctx.orgIds]);
  return db.$transaction(async (tx) => {
    await setConfig(tx, 'app.user_id', ctx.userId);
    await setConfig(tx, 'app.entity_ids', ctx.entityIds.join(','));
    await setConfig(tx, 'app.org_ids', ctx.orgIds.join(','));
    return fn(tx);
  });
}

/**
 * Contexte de provisioning : uniquement pour la transaction d'onboarding qui crée
 * l'organisation et ses entités (US-2.1). Les identifiants sont pré-générés côté
 * application et posés dans le contexte AVANT les INSERT : PostgreSQL applique la
 * politique SELECT aux lignes renvoyées par `INSERT … RETURNING` (utilisé par
 * Prisma), les nouvelles lignes doivent donc être visibles dans le contexte.
 */
export async function withProvisioning<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertUuids([ctx.userId, ...ctx.entityIds, ...ctx.orgIds]);
  return db.$transaction(async (tx) => {
    await setConfig(tx, 'app.user_id', ctx.userId);
    await setConfig(tx, 'app.entity_ids', ctx.entityIds.join(','));
    await setConfig(tx, 'app.org_ids', ctx.orgIds.join(','));
    await setConfig(tx, 'app.provisioning', 'on');
    return fn(tx);
  });
}
