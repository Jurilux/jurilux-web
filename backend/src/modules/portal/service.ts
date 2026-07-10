import type { Db, TenantContext } from '../../db.js';
import { SYSTEM_ACTOR, withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest, forbidden, notFound } from '../../errors.js';
import { newOpaqueToken, sha256Hex } from '../../crypto.js';
import { uploadDocument } from '../documents/service.js';
import type { StorageAdapter } from '../../storage.js';

// M11 — Portail client (version minimale de la phase 2) :
// lien magique à durée limitée, page de dépôt SANS compte, consentement RGPD
// obligatoire, données arrivant en « proposition » que l'avocat valide.
// Le jeton n'est stocké qu'en SHA-256 ; l'URL embarque entityId (opaque) pour
// permettre la résolution sous RLS avec un contexte système restreint.

const LINK_TTL_DAYS = 7;

export async function createPortalLink(db: Db, ctx: TenantContext, clientId: string) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw notFound('client inconnu');
    const token = newOpaqueToken();
    const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 86_400_000);
    await tx.portalLink.create({
      data: { entityId, clientId, tokenHash: sha256Hex(token), expiresAt, createdBy: ctx.userId },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'portal.link_created',
      objectType: 'client',
      objectId: clientId,
    });
    return {
      path: `/portal?e=${entityId}&t=${token}`,
      expiresAt,
    };
  });
}

const portalCtx = (entityId: string): TenantContext => ({
  userId: SYSTEM_ACTOR,
  entityIds: [entityId],
  orgIds: [],
});

async function resolveLink(db: Db, entityId: string, token: string) {
  return withTenantContext(db, portalCtx(entityId), async (tx) => {
    const link = await tx.portalLink.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!link || link.revokedAt || link.expiresAt < new Date()) {
      throw forbidden('lien invalide ou expiré');
    }
    const client = await tx.client.findUnique({ where: { id: link.clientId } });
    return { link, client: client! };
  });
}

/** Vue publique : le strict nécessaire pour que le client sache où il dépose. */
export async function portalView(db: Db, entityId: string, token: string) {
  const { link, client } = await resolveLink(db, entityId, token);
  const entity = await withTenantContext(db, portalCtx(entityId), (tx) =>
    tx.complianceEntity.findUnique({ where: { id: entityId } }),
  );
  return {
    firmName: entity?.name ?? '',
    clientDisplayName: client.displayName,
    expiresAt: link.expiresAt,
    accepts: ['id_card', 'passport', 'rcs_extract', 'statutes', 'proof_of_address', 'other'],
  };
}

/** Dépôt d'une pièce par le client final — consentement RGPD obligatoire. */
export async function portalUpload(
  db: Db,
  storage: StorageAdapter,
  entityId: string,
  token: string,
  input: { docType: string; fileName: string; data: Buffer; consent: boolean },
) {
  if (!input.consent) throw badRequest('consent_required', 'consentement RGPD obligatoire');
  const { link } = await resolveLink(db, entityId, token);
  const ctx = portalCtx(entityId);
  const uploaded = await uploadDocument(db, storage, ctx, {
    ownerType: 'client',
    ownerId: link.clientId,
    docType: `portal_${input.docType}`,
    fileName: input.fileName,
    data: input.data,
  });
  await withTenantContext(db, ctx, async (tx) => {
    await tx.portalSubmission.create({
      data: {
        entityId,
        linkId: link.id,
        clientId: link.clientId,
        kind: 'document',
        documentId: uploaded.documentId,
        payloadJson: { docType: input.docType, consent: true } as never,
      },
    });
    await appendAudit(tx, {
      entityId,
      action: 'portal.document_submitted',
      objectType: 'client',
      objectId: link.clientId,
    });
  });
  return { received: true };
}

/** Confirmation (ou correction) des bénéficiaires effectifs par le client final. */
export async function portalConfirmBe(
  db: Db,
  entityId: string,
  token: string,
  input: { confirmed: boolean; comment?: string | undefined; consent: boolean },
) {
  if (!input.consent) throw badRequest('consent_required');
  const { link } = await resolveLink(db, entityId, token);
  await withTenantContext(db, portalCtx(entityId), async (tx) => {
    await tx.portalSubmission.create({
      data: {
        entityId,
        linkId: link.id,
        clientId: link.clientId,
        kind: 'be_confirmation',
        payloadJson: { confirmed: input.confirmed, comment: input.comment ?? null } as never,
      },
    });
    await appendAudit(tx, {
      entityId,
      action: 'portal.be_confirmation_submitted',
      objectType: 'client',
      objectId: link.clientId,
    });
  });
  return { received: true };
}

/** Côté avocat : propositions en attente, puis validation/rejet. */
export async function listSubmissions(db: Db, ctx: TenantContext) {
  return withTenantContext(db, ctx, async (tx) => {
    const submissions = await tx.portalSubmission.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    const clients = await tx.client.findMany({
      where: { id: { in: [...new Set(submissions.map((s) => s.clientId))] } },
      select: { id: true, displayName: true },
    });
    const byId = new Map(clients.map((c) => [c.id, c.displayName]));
    return submissions.map((s) => ({ ...s, clientDisplayName: byId.get(s.clientId) ?? '' }));
  });
}

export async function decideSubmission(
  db: Db,
  ctx: TenantContext,
  submissionId: string,
  decision: 'accepted' | 'rejected',
) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const submission = await tx.portalSubmission.findUnique({ where: { id: submissionId } });
    if (!submission) throw notFound('proposition inconnue');
    if (submission.status !== 'pending') throw badRequest('already_decided');
    await tx.portalSubmission.update({
      where: { id: submissionId },
      data: { status: decision, decidedBy: ctx.userId, decidedAt: new Date() },
    });
    // Rejet d'un document : la pièce est supprimée (minimisation RGPD).
    if (decision === 'rejected' && submission.documentId) {
      await tx.document.deleteMany({ where: { id: submission.documentId } });
    }
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: `portal.submission_${decision}`,
      objectType: 'portal_submission',
      objectId: submissionId,
    });
    return { status: decision };
  });
}
