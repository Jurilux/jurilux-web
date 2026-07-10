import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { notFound } from '../../errors.js';

// M8 — Registres : formations (RIO Titre 14), mandats PSSF, RBE (US-3.4),
// décisions. Tout est exigible en contrôle CCBL — chaque écriture est auditée.

export async function addTraining(
  db: Db,
  ctx: TenantContext,
  input: {
    personLabel: string;
    trainingDate: string;
    title: string;
    hours: number;
    organism?: string | undefined;
    attestationDocId?: string | undefined;
  },
) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const record = await tx.trainingRecord.create({
      data: {
        entityId,
        personLabel: input.personLabel,
        trainingDate: new Date(input.trainingDate),
        title: input.title,
        hours: input.hours.toFixed(2),
        organism: input.organism ?? null,
        attestationDocId: input.attestationDocId ?? null,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'registry.training_added',
      objectType: 'training',
      objectId: record.id,
    });
    return { id: record.id };
  });
}

/** Registre des formations avec total annuel par personne (RIO Titre 14). */
export async function listTrainings(db: Db, ctx: TenantContext, year?: number) {
  return withTenantContext(db, ctx, async (tx) => {
    const where = year
      ? {
          trainingDate: {
            gte: new Date(`${year}-01-01`),
            lt: new Date(`${year + 1}-01-01`),
          },
        }
      : {};
    const records = await tx.trainingRecord.findMany({
      where,
      orderBy: { trainingDate: 'desc' },
    });
    const totals = new Map<string, number>();
    for (const r of records) {
      totals.set(r.personLabel, (totals.get(r.personLabel) ?? 0) + Number(r.hours));
    }
    return {
      records,
      annualTotals: [...totals.entries()].map(([personLabel, hours]) => ({ personLabel, hours })),
    };
  });
}

export async function addPssfMandate(
  db: Db,
  ctx: TenantContext,
  input: {
    companyName: string;
    function: string;
    startDate: string;
    endDate?: string | undefined;
    matterId?: string | undefined;
  },
) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const mandate = await tx.pssfMandate.create({
      data: {
        entityId,
        companyName: input.companyName,
        function: input.function,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        matterId: input.matterId ?? null,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'registry.pssf_added',
      objectType: 'pssf_mandate',
      objectId: mandate.id,
    });
    return { id: mandate.id };
  });
}

export async function endPssfMandate(db: Db, ctx: TenantContext, mandateId: string, endDate: string) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const mandate = await tx.pssfMandate.findUnique({ where: { id: mandateId } });
    if (!mandate) throw notFound('mandat inconnu');
    await tx.pssfMandate.update({ where: { id: mandateId }, data: { endDate: new Date(endDate) } });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'registry.pssf_ended',
      objectType: 'pssf_mandate',
      objectId: mandateId,
    });
    return { ended: true };
  });
}

export async function listPssfMandates(db: Db, ctx: TenantContext) {
  return withTenantContext(db, ctx, async (tx) => {
    const mandates = await tx.pssfMandate.findMany({ orderBy: { startDate: 'desc' } });
    const now = new Date();
    return mandates.map((m) => ({ ...m, active: m.endDate === null || m.endDate > now }));
  });
}

/** Consultation RBE + workflow divergence (US-3.4) : constat, décision, signalement. */
export async function addRbeCheck(
  db: Db,
  ctx: TenantContext,
  input: {
    clientId: string;
    checkedAt: string;
    extractDocId?: string | undefined;
    divergence?: boolean | undefined;
    divergenceDetails?: string | undefined;
    decision?: string | undefined;
    reported?: boolean | undefined;
    reportedAt?: string | undefined;
  },
) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw notFound('client inconnu');
    const check = await tx.rbeCheck.create({
      data: {
        entityId,
        clientId: input.clientId,
        checkedAt: new Date(input.checkedAt),
        extractDocId: input.extractDocId ?? null,
        divergence: input.divergence ?? false,
        divergenceDetails: input.divergenceDetails ?? null,
        decision: input.decision ?? null,
        reported: input.reported ?? false,
        reportedAt: input.reportedAt ? new Date(input.reportedAt) : null,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: input.divergence ? 'registry.rbe_divergence' : 'registry.rbe_checked',
      objectType: 'rbe_check',
      objectId: check.id,
    });
    return { id: check.id };
  });
}

export async function listRbeChecks(db: Db, ctx: TenantContext) {
  return withTenantContext(db, ctx, (tx) =>
    tx.rbeCheck.findMany({ orderBy: { checkedAt: 'desc' } }),
  );
}

/**
 * Registre des décisions : agrège les décisions tracées ailleurs — overrides de
 * risque, levées de doute, re-qualifications. Les décisions DOS n'apparaissent
 * qu'en COMPTAGE (le contenu reste cloisonné, US-7.4).
 */
export async function decisionsRegistry(db: Db, ctx: TenantContext, includeDosCount: boolean) {
  return withTenantContext(db, ctx, async (tx) => {
    const [overrides, screeningDecisions, requalifications, dosDecided] = await Promise.all([
      tx.riskAssessment.findMany({
        where: { overrideLevel: { not: null } },
        select: {
          matterId: true,
          level: true,
          overrideLevel: true,
          overrideReason: true,
          overrideBy: true,
          createdAt: true,
        },
      }),
      tx.screeningHit.findMany({
        where: { status: { not: 'open' } },
        select: { subjectId: true, status: true, reason: true, decidedBy: true, decidedAt: true },
      }),
      tx.scopingRevision.findMany({
        where: { reason: { not: null } },
        select: { matterId: true, verdict: true, reason: true, decidedBy: true, createdAt: true },
      }),
      includeDosCount
        ? tx.suspicionReport.count({ where: { status: { in: ['declared', 'no_declaration'] } } })
        : Promise.resolve(null),
    ]);
    return {
      riskOverrides: overrides,
      screeningDecisions,
      requalifications,
      dosDecisionsCount: dosDecided,
    };
  });
}
