import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { regulatoryConfig } from '../../config/regulatory.js';
import { qualify, type ScopingAnswers } from './scoping.js';

// M4 — Dossiers (matters).
// US-4.1 : qualification à l'ouverture, verdict horodaté/versionné, re-qualification tracée.
// US-4.2 : dossier in scope → champs obligatoires avant activation.
// US-3.3 CA : pas d'activation in scope sans BE identifié (ou dirigeant principal justifié).
// US-4.4 : clôture = point de départ de la conservation (retention_due_at).

export interface CreateMatterInput {
  clientId: string;
  title: string;
  category:
    | 'real_estate'
    | 'company_formation'
    | 'pssf'
    | 'family_office'
    | 'tax_advice'
    | 'asset_management'
    | 'funds_of_third_parties'
    | 'litigation'
    | 'consultation'
    | 'other';
  answers: ScopingAnswers;
  fundsOrigin?: string | undefined;
  fundsOriginNote?: string | undefined;
  countries?: string[] | undefined;
  estVolume?: string | undefined;
  remoteRelationship?: boolean | undefined;
  thirdPartyIntroducer?: boolean | undefined;
}

export async function createMatter(db: Db, ctx: TenantContext, input: CreateMatterInput) {
  const entityId = ctx.entityIds[0]!;
  const result = qualify(input.answers);
  return withTenantContext(db, ctx, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw notFound('client inconnu');

    const matter = await tx.matter.create({
      data: {
        entityId,
        clientId: input.clientId,
        title: input.title,
        scopingVerdict: result.verdict,
        scopingAnswersJson: input.answers as never,
        scopingVersion: result.version,
        category: input.category,
        // US-4.3 : marquage PSSF automatique — alimentera le registre PSSF (M8).
        pssf: input.category === 'pssf',
        status: result.verdict === 'in_scope' ? 'pending_cdd' : 'draft',
        fundsOrigin: input.fundsOrigin ?? null,
        fundsOriginNote: input.fundsOriginNote ?? null,
        countries: input.countries ?? [],
        estVolume: input.estVolume ?? null,
        remoteRelationship: input.remoteRelationship ?? false,
        thirdPartyIntroducer: input.thirdPartyIntroducer ?? false,
      },
    });
    await tx.scopingRevision.create({
      data: {
        entityId,
        matterId: matter.id,
        verdict: result.verdict,
        answersJson: input.answers as never,
        version: result.version,
        reason: result.reason,
        decidedBy: ctx.userId,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'matter.created',
      objectType: 'matter',
      objectId: matter.id,
    });
    return { matterId: matter.id, verdict: result.verdict, reason: result.reason, status: matter.status };
  });
}

/** Re-qualification tracée (US-4.1) : nouvelles réponses + motif obligatoire. */
export async function requalifyMatter(
  db: Db,
  ctx: TenantContext,
  matterId: string,
  answers: ScopingAnswers,
  reason: string,
) {
  const entityId = ctx.entityIds[0]!;
  if (!reason.trim()) throw badRequest('reason_required', 'motif de re-qualification obligatoire');
  const result = qualify(answers);
  return withTenantContext(db, ctx, async (tx) => {
    const matter = await tx.matter.findUnique({ where: { id: matterId } });
    if (!matter) throw notFound('dossier inconnu');
    if (matter.status === 'closed') throw conflict('matter_closed');
    await tx.matter.update({
      where: { id: matterId },
      data: {
        scopingVerdict: result.verdict,
        scopingAnswersJson: answers as never,
        scopingVersion: result.version,
        // Un dossier devenu in scope repasse par la vigilance ; l'inverse reste où il est.
        ...(result.verdict === 'in_scope' && matter.status === 'draft'
          ? { status: 'pending_cdd' as const }
          : {}),
      },
    });
    await tx.scopingRevision.create({
      data: {
        entityId,
        matterId,
        verdict: result.verdict,
        answersJson: answers as never,
        version: result.version,
        reason,
        decidedBy: ctx.userId,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'matter.requalified',
      objectType: 'matter',
      objectId: matterId,
    });
    return { verdict: result.verdict, reason: result.reason };
  });
}

export interface ActivateOptions {
  /** Vrai si le rôle de l'appelant porte matter.activate_high_risk (compliance/owner). */
  canApproveHighRisk: boolean;
}

/**
 * Activation d'un dossier. Pour un dossier in scope :
 *  - champs obligatoires (US-4.2) : objet, origine des fonds, pays, volume estimé ;
 *  - CDD client (US-3.3) : identification (lien self) et, pour les PM/constructions,
 *    au moins un BE vérifié OU un dirigeant principal justifié ;
 *  - dossier gelé par un hit sanctions : activation impossible (US-5.4) ;
 *  - risque élevé (US-5.2) : origine du patrimoine documentée (funds_origin_note)
 *    + approbation compliance/owner obligatoire — vigilance renforcée.
 */
export async function activateMatter(
  db: Db,
  ctx: TenantContext,
  matterId: string,
  opts: ActivateOptions = { canApproveHighRisk: false },
) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const matter = await tx.matter.findUnique({ where: { id: matterId } });
    if (!matter) throw notFound('dossier inconnu');
    if (matter.frozen) {
      throw conflict('matter_frozen', 'dossier gelé : hit sanctions en attente de levée de doute');
    }
    if (matter.status !== 'draft' && matter.status !== 'pending_cdd') {
      throw conflict('invalid_status', `activation impossible depuis le statut ${matter.status}`);
    }

    // Vigilance renforcée si risque élevé (dernière évaluation, override compris).
    const latestAssessment = await tx.riskAssessment.findFirst({
      where: { matterId },
      orderBy: { createdAt: 'desc' },
    });
    const effectiveLevel = latestAssessment
      ? (latestAssessment.overrideLevel ?? latestAssessment.level)
      : null;
    if (effectiveLevel === 'high') {
      if (!matter.fundsOriginNote?.trim()) {
        throw badRequest(
          'wealth_origin_required',
          'Risque élevé : documenter l’origine du patrimoine (funds_origin_note) avant activation.',
        );
      }
      if (!opts.canApproveHighRisk) {
        throw badRequest(
          'high_risk_approval_required',
          'Risque élevé : l’activation requiert une approbation compliance ou owner (US-5.2).',
        );
      }
    }

    if (matter.scopingVerdict === 'in_scope') {
      const missing: string[] = [];
      if (!matter.fundsOrigin) missing.push('funds_origin');
      if (matter.countries.length === 0) missing.push('countries');
      if (!matter.estVolume) missing.push('est_volume');
      if (missing.length > 0) {
        throw badRequest('missing_required_fields', missing.join(', '));
      }

      const client = await tx.client.findUnique({
        where: { id: matter.clientId },
        include: { links: true },
      });
      if (!client) throw notFound('client inconnu');

      const selfIdentified = client.links.some((l) => l.role === 'self');
      if (!selfIdentified) throw badRequest('client_not_identified');

      if (client.kind !== 'natural') {
        const beOk = client.links.some(
          (l) =>
            (l.role === 'beneficial_owner' && l.verified) ||
            (l.role === 'principal_director' && l.justification !== null),
        );
        if (!beOk) {
          throw badRequest(
            'beneficial_owner_required',
            'Aucun bénéficiaire effectif vérifié ni dirigeant principal justifié (US-3.3).',
          );
        }
      }
    }

    await tx.matter.update({ where: { id: matterId }, data: { status: 'active' } });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'matter.activated',
      objectType: 'matter',
      objectId: matterId,
    });
    return { status: 'active' as const };
  });
}

/** Clôture : pose closed_at et l'échéance de conservation (clôture + N ans, paramétré). */
export async function closeMatter(db: Db, ctx: TenantContext, matterId: string) {
  const entityId = ctx.entityIds[0]!;
  const config = regulatoryConfig();
  return withTenantContext(db, ctx, async (tx) => {
    const matter = await tx.matter.findUnique({ where: { id: matterId } });
    if (!matter) throw notFound('dossier inconnu');
    if (matter.status === 'closed') throw conflict('matter_closed');
    if (matter.frozen) {
      throw conflict('matter_frozen', 'dossier gelé : hit sanctions en attente de levée de doute');
    }
    const closedAt = new Date();
    const retentionDueAt = new Date(closedAt);
    retentionDueAt.setFullYear(retentionDueAt.getFullYear() + config.retention_years);
    await tx.matter.update({
      where: { id: matterId },
      data: { status: 'closed', closedAt, retentionDueAt },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'matter.closed',
      objectType: 'matter',
      objectId: matterId,
    });
    return { status: 'closed' as const, retentionDueAt };
  });
}

export async function listMatters(db: Db, ctx: TenantContext) {
  return withTenantContext(db, ctx, (tx) =>
    tx.matter.findMany({
      orderBy: { openedAt: 'desc' },
      include: { client: { select: { displayName: true, kind: true } } },
    }),
  );
}
