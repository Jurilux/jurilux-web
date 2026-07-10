import { Prisma } from '../../../generated/prisma/index.js';
import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest, notFound } from '../../errors.js';

// M10 — Conservation & purge (US-10.2), gel légal, export de réversibilité (US-10.3),
// import initial (US-10.4).
// La purge : supprime les métadonnées de pièces, anonymise les données personnelles,
// conserve les statistiques agrégées (catégorie, verdict, risque) + journal de purge.

export async function setLegalHold(
  db: Db,
  ctx: TenantContext,
  matterId: string,
  hold: boolean,
  reason?: string,
) {
  const entityId = ctx.entityIds[0]!;
  if (hold && !reason?.trim()) throw badRequest('reason_required', 'motif de gel légal obligatoire');
  return withTenantContext(db, ctx, async (tx) => {
    const matter = await tx.matter.findUnique({ where: { id: matterId } });
    if (!matter) throw notFound('dossier inconnu');
    await tx.matter.update({
      where: { id: matterId },
      data: { legalHold: hold, legalHoldReason: hold ? reason! : null },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: hold ? 'retention.legal_hold_set' : 'retention.legal_hold_released',
      objectType: 'matter',
      objectId: matterId,
    });
    return { legalHold: hold };
  });
}

const ANON = 'ANONYMISÉ';

/**
 * Purge des dossiers dont l'échéance de conservation est atteinte (clôture + 5 ans),
 * sauf gel légal. Anonymise aussi le client et ses personnes si plus aucun dossier
 * non purgé ne les référence.
 */
export async function runPurge(db: Db, ctx: TenantContext) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const due = await tx.matter.findMany({
      where: {
        status: 'closed',
        legalHold: false,
        retentionDueAt: { not: null, lte: new Date() },
        // Un dossier déjà purgé garde retention_due_at : marqueur = titre anonymisé.
        NOT: { title: 'Dossier purgé' },
      },
    });

    const purged: string[] = [];
    for (const matter of due) {
      const docs = await tx.document.findMany({
        where: { ownerType: 'matter', ownerId: matter.id },
        select: { id: true },
      });
      await tx.document.deleteMany({ where: { ownerType: 'matter', ownerId: matter.id } });

      await tx.matter.update({
        where: { id: matter.id },
        data: {
          title: 'Dossier purgé',
          fundsOrigin: null,
          fundsOriginNote: null,
          scopingAnswersJson: {} as never,
        },
      });

      // Client orphelin de dossiers actifs/non purgés → anonymisation.
      const remaining = await tx.matter.count({
        where: { clientId: matter.clientId, NOT: { title: 'Dossier purgé' } },
      });
      let clientAnonymized = false;
      if (remaining === 0) {
        const links = await tx.clientLink.findMany({ where: { clientId: matter.clientId } });
        const personIds = links.map((l) => l.personId).filter((id): id is string => id !== null);
        await tx.person.updateMany({
          where: { id: { in: personIds } },
          data: {
            firstNames: ANON,
            lastName: ANON,
            birthDate: null,
            birthPlace: null,
            nationalities: [],
            addressJson: Prisma.DbNull,
            idNumber: null,
            profession: null,
            pepDetailsJson: Prisma.DbNull,
          },
        });
        await tx.document.deleteMany({
          where: { ownerType: 'person', ownerId: { in: personIds } },
        });
        await tx.document.deleteMany({ where: { ownerType: 'client', ownerId: matter.clientId } });
        await tx.client.update({
          where: { id: matter.clientId },
          data: { displayName: 'Client purgé', status: 'archived' },
        });
        clientAnonymized = true;
      }

      await tx.purgeLog.create({
        data: {
          entityId,
          matterId: matter.id,
          summaryJson: {
            deletedDocuments: docs.length,
            clientAnonymized,
            keptStats: { category: matter.category, verdict: matter.scopingVerdict },
          } as never,
        },
      });
      await appendAudit(tx, {
        entityId,
        actorId: ctx.userId,
        action: 'retention.purged',
        objectType: 'matter',
        objectId: matter.id,
      });
      purged.push(matter.id);
    }
    return { purgedMatters: purged };
  });
}

/** Export de réversibilité (US-10.3) : totalité des données de l'entité, DOS exclues. */
export async function reversibilityExport(db: Db, ctx: TenantContext) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const [
      entity, clients, persons, legalParties, links, matters, documents,
      assessments, runs, hits, reviews, revisions, trainings, pssf, rbe, args, purges,
    ] = await Promise.all([
      tx.complianceEntity.findUnique({ where: { id: entityId } }),
      tx.client.findMany(),
      tx.person.findMany(),
      tx.legalEntityParty.findMany(),
      tx.clientLink.findMany(),
      tx.matter.findMany(),
      tx.document.findMany(),
      tx.riskAssessment.findMany(),
      tx.screeningRun.findMany(),
      tx.screeningHit.findMany(),
      tx.periodicReview.findMany(),
      tx.scopingRevision.findMany(),
      tx.trainingRecord.findMany(),
      tx.pssfMandate.findMany(),
      tx.rbeCheck.findMany(),
      tx.argDocument.findMany(),
      tx.purgeLog.findMany(),
    ]);
    await appendAudit(tx, { entityId, actorId: ctx.userId, action: 'export.reversibility' });
    return {
      exportedAt: new Date().toISOString(),
      note: 'Les DOS ne figurent pas dans cet export (cloisonnement, US-7.4).',
      entity,
      clients, persons, legalParties, clientLinks: links,
      matters, documents,
      riskAssessments: assessments, screeningRuns: runs, screeningHits: hits,
      periodicReviews: reviews, scopingRevisions: revisions,
      registries: { trainings, pssfMandates: pssf, rbeChecks: rbe },
      argDocuments: args, purgeLog: purges,
    };
  });
}

// --- Import initial (US-10.4) : CSV clients PP, rapport d'erreurs par ligne ---
// Colonnes : lastName;firstNames;birthDate(YYYY-MM-DD)?;nationalities(LU|FR)?;profession?

export interface ImportResult {
  imported: number;
  errors: { line: number; error: string }[];
}

export async function importClientsCsv(db: Db, ctx: TenantContext, csv: string): Promise<ImportResult> {
  const entityId = ctx.entityIds[0]!;
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  const errors: { line: number; error: string }[] = [];
  let imported = 0;

  const start = lines[0]?.toLowerCase().startsWith('lastname') ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i]!.split(';').map((c) => c.trim());
    const [lastName, firstNames, birthDate, nationalities, profession] = cols;
    if (!lastName || !firstNames) {
      errors.push({ line: i + 1, error: 'lastName et firstNames obligatoires' });
      continue;
    }
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      errors.push({ line: i + 1, error: `date invalide: ${birthDate}` });
      continue;
    }
    try {
      await withTenantContext(db, ctx, async (tx) => {
        const person = await tx.person.create({
          data: {
            entityId,
            firstNames,
            lastName,
            birthDate: birthDate ? new Date(birthDate) : null,
            nationalities: nationalities ? nationalities.split('|').filter(Boolean) : [],
            profession: profession || null,
          },
        });
        const client = await tx.client.create({
          data: { entityId, kind: 'natural', displayName: `${lastName.toUpperCase()} ${firstNames}` },
        });
        await tx.clientLink.create({
          data: { entityId, clientId: client.id, personId: person.id, role: 'self' },
        });
      });
      imported++;
    } catch (e) {
      errors.push({ line: i + 1, error: String(e).slice(0, 200) });
    }
  }
  await withTenantContext(db, ctx, (tx) =>
    appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'import.clients_csv',
      objectId: `${imported} importés, ${errors.length} erreurs`,
    }),
  );
  return { imported, errors };
}
