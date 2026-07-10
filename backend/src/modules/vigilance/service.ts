import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { regulatoryConfig } from '../../config/regulatory.js';
import { assessMatterRisk } from '../risk/service.js';

// M6 — Vigilance continue & échéancier.
// US-6.1 : tableau « À faire » par entité.
// US-6.3 : revue périodique guidée → checklist → re-score → nouvelle échéance
// (faible 3 ans / moyen 2 ans / élevé 1 an, paramétré).

export function nextReviewDate(level: 'low' | 'medium' | 'high', from: Date = new Date()): Date {
  const years = regulatoryConfig().review_interval_years[level];
  const due = new Date(from);
  due.setFullYear(due.getFullYear() + years);
  return due;
}

export interface ReviewChecklist {
  identityStillValid: boolean;
  beneficialOwnersUnchanged: boolean;
  activityConsistent: boolean;
}

/** Revue périodique guidée : re-score systématique, tout est consigné (US-6.3). */
export async function completePeriodicReview(
  db: Db,
  ctx: TenantContext,
  matterId: string,
  checklist: ReviewChecklist,
  notes?: string,
) {
  const entityId = ctx.entityIds[0]!;
  // Re-score AVANT d'enregistrer la revue : l'échéance suivante dépend du niveau à jour.
  const assessment = await assessMatterRisk(db, ctx, matterId);
  return withTenantContext(db, ctx, async (tx) => {
    const matter = await tx.matter.findUnique({ where: { id: matterId } });
    if (!matter) throw notFound('dossier inconnu');
    if (matter.status === 'closed') throw conflict('matter_closed');

    const nextDueAt = nextReviewDate(assessment.level);
    await tx.periodicReview.create({
      data: {
        entityId,
        matterId,
        checklistJson: checklist as never,
        notes: notes ?? null,
        riskLevelAfter: assessment.level,
        nextDueAt,
        decidedBy: ctx.userId,
      },
    });
    await tx.matter.update({ where: { id: matterId }, data: { nextReviewAt: nextDueAt } });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'review.completed',
      objectType: 'matter',
      objectId: matterId,
    });
    return { riskLevel: assessment.level, nextReviewAt: nextDueAt };
  });
}

export interface TodoBoard {
  expiringDocuments: { id: string; docType: string; fileName: string; expiresAt: Date | null }[];
  staleRcsExtracts: { id: string; fileName: string; issuedAt: Date | null }[];
  reviewsDue: { matterId: string; title: string; nextReviewAt: Date | null }[];
  openAlerts: number;
  frozenMatters: number;
  purgeUpcoming: { matterId: string; title: string; retentionDueAt: Date | null }[];
}

/** Tableau « À faire » (US-6.1) — chaque rubrique vient des données réelles. */
export async function todoBoard(db: Db, ctx: TenantContext): Promise<TodoBoard> {
  const config = regulatoryConfig();
  const now = new Date();
  const expiryHorizon = new Date(now);
  expiryHorizon.setDate(expiryHorizon.getDate() + config.id_expiry_warning_days);
  const rcsLimit = new Date(now);
  rcsLimit.setMonth(rcsLimit.getMonth() - config.rcs_extract_max_age_months);
  const purgeHorizon = new Date(now);
  purgeHorizon.setDate(purgeHorizon.getDate() + 90); // notification J-90 (US-10.2)

  return withTenantContext(db, ctx, async (tx) => {
    const [expiring, staleRcs, reviews, openAlerts, frozen, purgeSoon] = await Promise.all([
      tx.document.findMany({
        where: { expiresAt: { not: null, lte: expiryHorizon } },
        select: { id: true, docType: true, fileName: true, expiresAt: true },
        orderBy: { expiresAt: 'asc' },
      }),
      tx.document.findMany({
        where: { docType: 'rcs_extract', issuedAt: { not: null, lt: rcsLimit } },
        select: { id: true, fileName: true, issuedAt: true },
      }),
      tx.matter.findMany({
        where: { status: { not: 'closed' }, nextReviewAt: { not: null, lte: now } },
        select: { id: true, title: true, nextReviewAt: true },
      }),
      tx.screeningHit.count({ where: { status: 'open' } }),
      tx.matter.count({ where: { frozen: true } }),
      tx.matter.findMany({
        where: {
          status: 'closed',
          legalHold: false,
          retentionDueAt: { not: null, lte: purgeHorizon },
        },
        select: { id: true, title: true, retentionDueAt: true },
      }),
    ]);
    return {
      expiringDocuments: expiring,
      staleRcsExtracts: staleRcs,
      reviewsDue: reviews.map((m) => ({ matterId: m.id, title: m.title, nextReviewAt: m.nextReviewAt })),
      openAlerts,
      frozenMatters: frozen,
      purgeUpcoming: purgeSoon.map((m) => ({
        matterId: m.id,
        title: m.title,
        retentionDueAt: m.retentionDueAt,
      })),
    };
  });
}

/** Rappel : refusé si le dossier n'a jamais été évalué — l'échéance dépend du risque. */
export function ensureAssessed(level: string | null): asserts level is 'low' | 'medium' | 'high' {
  if (level !== 'low' && level !== 'medium' && level !== 'high') {
    throw badRequest('risk_assessment_required', 'évaluer le risque avant de planifier la revue');
  }
}
