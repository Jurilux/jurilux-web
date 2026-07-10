import { createHash } from 'node:crypto';
import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest, notFound } from '../../errors.js';
import { screeningConfig } from '../../config/screening.js';
import { matchSubject, normalizeName, type MatchParams } from './matching.js';
import { parseEuList, parseUnList, withNormalizedNames } from './parsers.js';

// M5 — Screening sanctions (US-5.4 à US-5.6).
// Import versionné des listes UE/ONU ; matching de toutes les personnes de
// l'entité ; hit → alerte BLOQUANTE : tous les dossiers non clos des clients
// liés à la personne sont gelés jusqu'à levée de doute (US-5.5).

export async function importList(db: Db, source: 'EU' | 'UN', xml: string) {
  const checksum = createHash('sha256').update(xml).digest('hex');
  const last = await db.listVersion.findFirst({
    where: { source },
    orderBy: { importedAt: 'desc' },
  });
  if (last?.rawChecksum === checksum) {
    return { skipped: true, listVersionId: last.id, entryCount: last.entryCount };
  }
  const parsed = withNormalizedNames(source === 'EU' ? parseEuList(xml) : parseUnList(xml));
  if (parsed.length === 0) throw badRequest('empty_list', 'aucune entrée exploitable');

  const version = await db.listVersion.create({
    data: {
      source,
      versionTag: `${source}-${new Date().toISOString().slice(0, 10)}-${checksum.slice(0, 8)}`,
      rawChecksum: checksum,
      entryCount: parsed.length,
    },
  });
  // createMany : INSERT sans RETURNING, par lots.
  const BATCH = 500;
  for (let i = 0; i < parsed.length; i += BATCH) {
    await db.listEntry.createMany({
      data: parsed.slice(i, i + BATCH).map((e) => ({
        listVersionId: version.id,
        source,
        externalId: e.externalId,
        kind: e.kind,
        names: e.names,
        normalizedNames: e.normalizedNames,
        birthDates: e.birthDates,
        nationalities: e.nationalities,
      })),
    });
  }
  return { skipped: false, listVersionId: version.id, entryCount: parsed.length };
}

async function latestListVersions(db: Db) {
  const versions = [];
  for (const source of ['EU', 'UN'] as const) {
    const v = await db.listVersion.findFirst({
      where: { source },
      orderBy: { importedAt: 'desc' },
    });
    if (v) versions.push(v);
  }
  return versions;
}

export interface RunResult {
  runId: string;
  subjectCount: number;
  newHits: number;
  listVersions: { source: string; versionTag: string }[];
}

/**
 * Screening de toutes les personnes de l'entité contre les dernières versions
 * de listes. Chaque exécution enregistre versions, paramètres, sujets, résultat
 * (US-5.4 CA). Les hits déjà connus (même sujet + même entrée) ne sont pas dupliqués.
 */
export async function runScreening(db: Db, ctx: TenantContext): Promise<RunResult> {
  const entityId = ctx.entityIds[0]!;
  const cfg = screeningConfig();
  const params: MatchParams = {
    similarityThreshold: cfg.similarity_threshold,
    birthYearTolerance: cfg.birth_year_tolerance,
    nationalityMismatchPenalty: cfg.nationality_mismatch_penalty,
    birthYearMismatchDiscard: cfg.birth_year_mismatch_discard,
  };

  const versions = await latestListVersions(db);
  if (versions.length === 0) throw badRequest('no_lists_imported');
  const entries = await db.listEntry.findMany({
    where: { listVersionId: { in: versions.map((v) => v.id) }, kind: 'person' },
  });

  return withTenantContext(db, ctx, async (tx) => {
    const persons = await tx.person.findMany();
    const existing = await tx.screeningHit.findMany({
      select: { subjectId: true, listExternalId: true },
    });
    const known = new Set(existing.map((h) => `${h.subjectId}|${h.listExternalId}`));

    const run = await tx.screeningRun.create({
      data: {
        entityId,
        listVersionsJson: versions.map((v) => ({ source: v.source, versionTag: v.versionTag })) as never,
        algoParamsJson: { algorithm: 'jaro-winkler+token-sort', ...params } as never,
        subjectCount: persons.length,
        hitCount: 0,
      },
    });

    let newHits = 0;
    const affectedPersons: string[] = [];
    for (const person of persons) {
      const profile = {
        fullName: `${person.firstNames} ${person.lastName}`,
        birthYear: person.birthDate ? person.birthDate.getFullYear() : undefined,
        nationalities: person.nationalities,
      };
      for (const entry of entries) {
        if (known.has(`${person.id}|${entry.externalId}`)) continue;
        const result = matchSubject(profile, entry, params);
        if (!result.matched) continue;
        await tx.screeningHit.create({
          data: {
            entityId,
            runId: run.id,
            subjectType: 'person',
            subjectId: person.id,
            listSource: entry.source,
            listExternalId: entry.externalId,
            listEntryJson: {
              names: entry.names,
              birthDates: entry.birthDates,
              nationalities: entry.nationalities,
            } as never,
            similarity: result.similarity.toFixed(4),
          },
        });
        known.add(`${person.id}|${entry.externalId}`);
        newHits++;
        affectedPersons.push(person.id);
        await appendAudit(tx, {
          entityId,
          actorId: ctx.userId,
          action: 'screening.hit_detected',
          objectType: 'person',
          objectId: person.id,
        });
      }
    }

    // Alerte bloquante : gel de tous les dossiers non clos des clients liés (US-5.4).
    if (affectedPersons.length > 0) {
      const links = await tx.clientLink.findMany({
        where: { personId: { in: affectedPersons } },
        select: { clientId: true },
      });
      const clientIds = [...new Set(links.map((l) => l.clientId))];
      if (clientIds.length > 0) {
        const frozen = await tx.matter.updateMany({
          where: { clientId: { in: clientIds }, status: { not: 'closed' }, frozen: false },
          data: { frozen: true },
        });
        if (frozen.count > 0) {
          await appendAudit(tx, {
            entityId,
            actorId: ctx.userId,
            action: 'matter.frozen_by_screening',
            objectType: 'screening_run',
            objectId: run.id,
          });
        }
      }
    }

    await tx.screeningRun.update({ where: { id: run.id }, data: { hitCount: newHits } });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'screening.run_completed',
      objectType: 'screening_run',
      objectId: run.id,
    });
    return {
      runId: run.id,
      subjectCount: persons.length,
      newHits,
      listVersions: versions.map((v) => ({ source: v.source, versionTag: v.versionTag })),
    };
  });
}

/** Alertes ouvertes (écran de levée de doute, US-5.5) avec le sujet côte à côte. */
export async function listOpenAlerts(db: Db, ctx: TenantContext) {
  return withTenantContext(db, ctx, async (tx) => {
    const hits = await tx.screeningHit.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
    });
    const personIds = [...new Set(hits.map((h) => h.subjectId))];
    const persons = await tx.person.findMany({ where: { id: { in: personIds } } });
    const byId = new Map(persons.map((p) => [p.id, p]));
    return hits.map((h) => {
      const p = byId.get(h.subjectId);
      return {
        id: h.id,
        similarity: Number(h.similarity),
        listSource: h.listSource,
        listExternalId: h.listExternalId,
        listEntry: h.listEntryJson,
        createdAt: h.createdAt,
        subject: p
          ? {
              personId: p.id,
              fullName: `${p.firstNames} ${p.lastName}`,
              birthDate: p.birthDate,
              nationalities: p.nationalities,
            }
          : null,
      };
    });
  });
}

/**
 * Levée de doute (US-5.5) : décision motivée, signée, horodatée.
 * false_positive → dégel des dossiers si plus aucun hit actif sur le client.
 * confirmed → le dossier reste gelé (mesures restrictives : gel et notification).
 */
export async function decideHit(
  db: Db,
  ctx: TenantContext,
  hitId: string,
  decision: 'false_positive' | 'confirmed',
  reason: string,
) {
  const entityId = ctx.entityIds[0]!;
  if (!reason.trim()) throw badRequest('reason_required');
  return withTenantContext(db, ctx, async (tx) => {
    const hit = await tx.screeningHit.findUnique({ where: { id: hitId } });
    if (!hit) throw notFound('alerte inconnue');
    if (hit.status !== 'open') throw badRequest('already_decided');

    await tx.screeningHit.update({
      where: { id: hitId },
      data: { status: decision, decidedBy: ctx.userId, decidedAt: new Date(), reason },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: `screening.hit_${decision}`,
      objectType: 'screening_hit',
      objectId: hitId,
    });

    let unfrozen = 0;
    if (decision === 'false_positive') {
      // Dégel si plus aucun hit actif (open ou confirmed) sur les personnes des clients concernés.
      const links = await tx.clientLink.findMany({
        where: { personId: hit.subjectId },
        select: { clientId: true },
      });
      for (const { clientId } of links) {
        const clientPersonIds = (
          await tx.clientLink.findMany({ where: { clientId }, select: { personId: true } })
        )
          .map((l) => l.personId)
          .filter((id): id is string => id !== null);
        const activeHits = await tx.screeningHit.count({
          where: { subjectId: { in: clientPersonIds }, status: { in: ['open', 'confirmed'] } },
        });
        if (activeHits === 0) {
          const result = await tx.matter.updateMany({
            where: { clientId, frozen: true },
            data: { frozen: false },
          });
          unfrozen += result.count;
        }
      }
      if (unfrozen > 0) {
        await appendAudit(tx, {
          entityId,
          actorId: ctx.userId,
          action: 'matter.unfrozen',
          objectType: 'screening_hit',
          objectId: hitId,
        });
      }
    }
    return { status: decision, unfrozenMatters: unfrozen };
  });
}
