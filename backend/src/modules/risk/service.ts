import type { Db, TenantContext, Tx } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest, notFound } from '../../errors.js';
import {
  countryRiskConfig,
  defaultRiskMatrix,
  validateCustomMatrix,
  type RiskMatrix,
} from '../../config/screening.js';
import { computeRisk, type TriggerFlags } from './engine.js';

/** Matrice active de l'entité : dernière version personnalisée, sinon défaut (US-5.1). */
async function activeMatrix(tx: Tx): Promise<RiskMatrix> {
  const custom = await tx.riskMatrixVersion.findFirst({ orderBy: { version: 'desc' } });
  if (!custom) return defaultRiskMatrix();
  const matrix = custom.matrixJson as RiskMatrix;
  // Version affichée : "entité-vN" pour distinguer du défaut.
  return { ...matrix, version: `${matrix.version}-v${custom.version}` };
}

// M5 — Évaluation du risque d'un dossier : les drapeaux sont dérivés des données
// réelles (PEP des personnes liées, pays du dossier vs listes en configuration,
// catégorie de service, canal, hits sanctions actifs). L'instantané des facteurs
// déclenchés et la version de matrice sont conservés (reproductibilité, US-5.1).

export async function assessMatterRisk(db: Db, ctx: TenantContext, matterId: string) {
  const entityId = ctx.entityIds[0]!;
  const countries = countryRiskConfig();

  return withTenantContext(db, ctx, async (tx) => {
    const matrix = await activeMatrix(tx);
    const matter = await tx.matter.findUnique({ where: { id: matterId } });
    if (!matter) throw notFound('dossier inconnu');

    const links = await tx.clientLink.findMany({ where: { clientId: matter.clientId } });
    const personIds = links.map((l) => l.personId).filter((id): id is string => id !== null);
    const persons = await tx.person.findMany({ where: { id: { in: personIds } } });

    const pepPresent = persons.some((p) => p.pepStatus !== 'not_pep');
    const activeHits = await tx.screeningHit.count({
      where: { subjectId: { in: personIds }, status: { in: ['open', 'confirmed'] } },
    });
    const ownershipLayers = links.filter((l) => l.role === 'beneficial_owner').length;

    const flags: TriggerFlags = {
      pep_present: pepPresent,
      open_sanctions_hit: activeHits > 0,
      remote_relationship: matter.remoteRelationship,
      third_party_introducer: matter.thirdPartyIntroducer,
      multi_layer_ownership: ownershipLayers >= 2,
      country_gafi_black: matter.countries.some((c) => countries.gafi_black.includes(c)),
      country_gafi_grey: matter.countries.some((c) => countries.gafi_grey.includes(c)),
      country_eu_high_risk: matter.countries.some((c) => countries.eu_high_risk.includes(c)),
      country_offshore: matter.countries.some((c) => countries.offshore.includes(c)),
      [`category_${matter.category}`]: true,
    };

    const result = computeRisk(matrix, flags);
    const assessment = await tx.riskAssessment.create({
      data: {
        entityId,
        matterId,
        matrixVersion: result.matrixVersion,
        score: result.score,
        level: result.level,
        factorsJson: result.factors as never,
        createdBy: ctx.userId,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'risk.assessed',
      objectType: 'matter',
      objectId: matterId,
    });
    return {
      assessmentId: assessment.id,
      score: result.score,
      level: result.level,
      matrixVersion: result.matrixVersion,
      factors: result.factors,
    };
  });
}

/** Matrice active (lecture) + historique des versions. */
export async function getRiskMatrix(db: Db, ctx: TenantContext) {
  return withTenantContext(db, ctx, async (tx) => {
    const matrix = await activeMatrix(tx);
    const versions = await tx.riskMatrixVersion.findMany({
      orderBy: { version: 'desc' },
      select: { version: true, createdBy: true, createdAt: true },
    });
    return { matrix, customVersions: versions, isDefault: versions.length === 0 };
  });
}

/**
 * Édition de la matrice par le RC (US-5.1) : structure validée, facteurs forcés
 * intouchables (US-5.2), versionnée — les évaluations passées gardent leur instantané.
 */
export async function updateRiskMatrix(db: Db, ctx: TenantContext, input: unknown) {
  const entityId = ctx.entityIds[0]!;
  let matrix: RiskMatrix;
  try {
    matrix = validateCustomMatrix(input);
  } catch (e) {
    throw badRequest('invalid_matrix', String(e instanceof Error ? e.message : e));
  }
  return withTenantContext(db, ctx, async (tx) => {
    const last = await tx.riskMatrixVersion.findFirst({ orderBy: { version: 'desc' } });
    const version = (last?.version ?? 0) + 1;
    await tx.riskMatrixVersion.create({
      data: { entityId, version, matrixJson: matrix as never, createdBy: ctx.userId },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'risk.matrix_updated',
      objectId: `v${version}`,
    });
    return { version };
  });
}

/**
 * Recalcul en masse après changement de matrice (US-5.1 CA) : ré-évalue tous les
 * dossiers non clos et rend le rapport des différences.
 */
export async function massRecalcRisks(db: Db, ctx: TenantContext) {
  const matters = await withTenantContext(db, ctx, (tx) =>
    tx.matter.findMany({ where: { status: { not: 'closed' } }, select: { id: true, title: true } }),
  );
  const before = new Map<string, string>();
  await withTenantContext(db, ctx, async (tx) => {
    for (const m of matters) {
      const latest = await tx.riskAssessment.findFirst({
        where: { matterId: m.id },
        orderBy: { createdAt: 'desc' },
      });
      if (latest) before.set(m.id, (latest.overrideLevel ?? latest.level) as string);
    }
  });

  const changes: { matterId: string; title: string; before: string | null; after: string }[] = [];
  for (const m of matters) {
    const result = await assessMatterRisk(db, ctx, m.id);
    const prev = before.get(m.id) ?? null;
    if (prev !== result.level) {
      changes.push({ matterId: m.id, title: m.title, before: prev, after: result.level });
    }
  }
  return { reassessed: matters.length, changes };
}

/** Override manuel du niveau (US-5.3) : motif obligatoire, tracé, visible dans les exports. */
export async function overrideMatterRisk(
  db: Db,
  ctx: TenantContext,
  matterId: string,
  level: 'low' | 'medium' | 'high',
  reason: string,
) {
  const entityId = ctx.entityIds[0]!;
  if (!reason.trim()) throw badRequest('reason_required', 'motif d’override obligatoire');
  return withTenantContext(db, ctx, async (tx) => {
    const latest = await tx.riskAssessment.findFirst({
      where: { matterId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) throw notFound('aucune évaluation à surcharger');

    // US-5.2 : le risque élevé automatique n'est pas dégradable si un facteur forcé est actif.
    const forced = (latest.factorsJson as { forced?: string }[]).some((f) => f.forced === 'high');
    if (forced && level !== 'high') {
      throw badRequest(
        'forced_high_risk',
        'Facteur à risque élevé forcé actif (PEP, pays, sanctions) : niveau non dégradable.',
      );
    }

    await tx.riskAssessment.update({
      where: { id: latest.id },
      data: { overrideLevel: level, overrideReason: reason, overrideBy: ctx.userId },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'risk.overridden',
      objectType: 'matter',
      objectId: matterId,
    });
    return { level, overridden: true };
  });
}

