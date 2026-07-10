import { sha256Hex } from './crypto.js';
import type { Tx } from './db.js';

// Journal d'audit append-only à chaînage de hachés (US-10.1) :
// chaque événement embarque le hash du précédent ; toute altération casse la chaîne.
// Un verrou consultatif transactionnel sérialise les insertions pour garantir
// un chaînage linéaire sans trou.

export interface AuditInput {
  entityId?: string | null;
  actorId?: string | null;
  action: string;
  objectType?: string | null;
  objectId?: string | null;
  ip?: string | null;
}

const GENESIS = 'genesis';

export async function appendAudit(tx: Tx, input: AuditInput): Promise<void> {
  // La tête de chaîne (ligne unique, hors RLS) est verrouillée pour la durée de la
  // transaction : les insertions concurrentes se sérialisent, le chaînage reste linéaire.
  const head = await tx.$queryRaw<{ last_hash: string }[]>`
    SELECT last_hash FROM audit_chain WHERE id = 1 FOR UPDATE`;
  const prevHash = head[0]?.last_hash ?? GENESIS;
  const at = new Date();
  const hash = sha256Hex(
    [
      prevHash,
      input.entityId ?? '',
      input.actorId ?? '',
      input.action,
      input.objectType ?? '',
      input.objectId ?? '',
      input.ip ?? '',
      at.toISOString(),
    ].join('|'),
  );
  // createMany : INSERT sans RETURNING — la visibilité SELECT sous RLS n'est pas
  // requise pour journaliser (les événements plateforme ont entity_id NULL).
  await tx.auditEvent.createMany({
    data: [
      {
        entityId: input.entityId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        objectType: input.objectType ?? null,
        objectId: input.objectId ?? null,
        ip: input.ip ?? null,
        at,
        prevHash,
        hash,
      },
    ],
  });
  await tx.auditChain.update({ where: { id: 1 }, data: { lastHash: hash } });
}

/**
 * Vérifie l'intégrité de la chaîne ; retourne l'id du premier événement corrompu, ou null.
 * À exécuter avec une connexion privilégiée (outillage d'exploitation) : sous RLS,
 * seuls les événements du contexte courant seraient visibles.
 */
export async function verifyAuditChain(tx: Tx): Promise<bigint | null> {
  const events = await tx.auditEvent.findMany({ orderBy: { id: 'asc' } });
  let prev = GENESIS;
  for (const e of events) {
    const expected = sha256Hex(
      [
        prev,
        e.entityId ?? '',
        e.actorId ?? '',
        e.action,
        e.objectType ?? '',
        e.objectId ?? '',
        e.ip ?? '',
        e.at.toISOString(),
      ].join('|'),
    );
    if (e.prevHash !== prev || e.hash !== expected) return e.id;
    prev = e.hash;
  }
  return null;
}
