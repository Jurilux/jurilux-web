import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';

// M9 — Rapport « questionnaire annuel de l'Ordre » (US-9.1), ARG assistée (US-9.3),
// export contrôle CCBL (US-9.2). Chaque valeur agrégée reste traçable : les listes
// de dossiers sous-jacentes sont incluses (auditabilité).
// Les DOS n'apparaissent qu'en COMPTAGE (US-7.4) — jamais leur contenu.

const mappingPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../config/bar_questionnaire_mapping_2026.json',
);

export function questionnaireMapping(): unknown {
  return JSON.parse(readFileSync(mappingPath, 'utf8'));
}

function inYear(d: Date | null, year: number): boolean {
  return d !== null && d.getFullYear() === year;
}

export async function annualReport(db: Db, ctx: TenantContext, year: number) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const [matters, clients, links, assessments, dosDeclared, trainings, pssf] = await Promise.all([
      tx.matter.findMany(),
      tx.client.findMany(),
      tx.clientLink.findMany(),
      tx.riskAssessment.findMany({ orderBy: { createdAt: 'asc' } }),
      tx.suspicionReport.count({
        where: {
          status: 'declared',
          decidedAt: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) },
        },
      }),
      tx.trainingRecord.findMany({
        where: {
          trainingDate: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) },
        },
      }),
      tx.pssfMandate.findMany(),
    ]);

    const persons = await tx.person.findMany();
    const legalParties = await tx.legalEntityParty.findMany();

    // Dernière évaluation par dossier (override compris).
    const latestLevel = new Map<string, string>();
    for (const a of assessments) latestLevel.set(a.matterId, (a.overrideLevel ?? a.level) as string);

    const opened = matters.filter((m) => inYear(m.openedAt, year));
    const closed = matters.filter((m) => inYear(m.closedAt, year));
    const activeEndOfYear = matters.filter(
      (m) => m.openedAt.getFullYear() <= year && (!m.closedAt || m.closedAt.getFullYear() > year),
    );
    const inScope = matters.filter((m) => m.scopingVerdict === 'in_scope');

    const byCategory: Record<string, { count: number; matterIds: string[] }> = {};
    for (const m of inScope) {
      byCategory[m.category] ??= { count: 0, matterIds: [] };
      byCategory[m.category]!.count++;
      byCategory[m.category]!.matterIds.push(m.id);
    }

    const byKind: Record<string, number> = {};
    for (const c of clients) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;

    // Pays : PP = première nationalité ; PM = pays du siège (via lien self).
    const byCountry: Record<string, number> = {};
    const personById = new Map(persons.map((p) => [p.id, p]));
    const partyById = new Map(legalParties.map((p) => [p.id, p]));
    for (const c of clients) {
      const self = links.find((l) => l.clientId === c.id && l.role === 'self');
      const country = self?.personId
        ? (personById.get(self.personId)?.nationalities[0] ?? 'ND')
        : self?.legalPartyId
          ? (partyById.get(self.legalPartyId)?.country ?? 'ND')
          : 'ND';
      byCountry[country] = (byCountry[country] ?? 0) + 1;
    }

    const byRisk: Record<string, { count: number; matterIds: string[] }> = {};
    for (const m of matters) {
      const level = latestLevel.get(m.id) ?? 'non_evalue';
      byRisk[level] ??= { count: 0, matterIds: [] };
      byRisk[level]!.count++;
      byRisk[level]!.matterIds.push(m.id);
    }

    const pepCount = persons.filter((p) => p.pepStatus !== 'not_pep').length;
    const enhanced = matters.filter((m) => latestLevel.get(m.id) === 'high');

    const report = {
      year,
      generatedAt: new Date().toISOString(),
      mapping: questionnaireMapping(),
      sections: {
        matters_total: {
          opened: { count: opened.length, matterIds: opened.map((m) => m.id) },
          closed: { count: closed.length, matterIds: closed.map((m) => m.id) },
          activeEndOfYear: { count: activeEndOfYear.length, matterIds: activeEndOfYear.map((m) => m.id) },
          inScope: { count: inScope.length, matterIds: inScope.map((m) => m.id) },
        },
        matters_in_scope_by_category: byCategory,
        clients_by_type: byKind,
        clients_by_country: byCountry,
        clients_by_risk: byRisk,
        pep_count: pepCount,
        vigilance_measures: {
          standard: matters.length - enhanced.length,
          enhanced: { count: enhanced.length, matterIds: enhanced.map((m) => m.id) },
        },
        dos_declared_count: dosDeclared,
        trainings: {
          totalHours: trainings.reduce((s, t) => s + Number(t.hours), 0),
          participants: [...new Set(trainings.map((t) => t.personLabel))].length,
        },
        pssf_active_count: pssf.filter((m) => m.endDate === null || m.endDate > new Date()).length,
      },
    };

    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'report.annual_generated',
      objectType: 'report',
      objectId: String(year),
    });
    return report;
  });
}

/** Rendu CSV du rapport (US-9.1 : PDF + CSV — le CSV ici, l'impression via le front). */
export function annualReportCsv(report: Awaited<ReturnType<typeof annualReport>>): string {
  const rows: string[][] = [['section', 'cle', 'valeur']];
  const s = report.sections;
  rows.push(['dossiers', 'ouverts', String(s.matters_total.opened.count)]);
  rows.push(['dossiers', 'clos', String(s.matters_total.closed.count)]);
  rows.push(['dossiers', 'actifs_fin_annee', String(s.matters_total.activeEndOfYear.count)]);
  rows.push(['dossiers', 'in_scope', String(s.matters_total.inScope.count)]);
  for (const [cat, v] of Object.entries(s.matters_in_scope_by_category)) {
    rows.push(['in_scope_par_categorie', cat, String(v.count)]);
  }
  for (const [kind, n] of Object.entries(s.clients_by_type)) rows.push(['clients_par_type', kind, String(n)]);
  for (const [country, n] of Object.entries(s.clients_by_country)) {
    rows.push(['clients_par_pays', country, String(n)]);
  }
  for (const [level, v] of Object.entries(s.clients_by_risk)) {
    rows.push(['dossiers_par_risque', level, String(v.count)]);
  }
  rows.push(['pep', 'nombre', String(s.pep_count)]);
  rows.push(['vigilance', 'standard', String(s.vigilance_measures.standard)]);
  rows.push(['vigilance', 'renforcee', String(s.vigilance_measures.enhanced.count)]);
  rows.push(['dos', 'declarees', String(s.dos_declared_count)]);
  rows.push(['formations', 'heures_totales', String(s.trainings.totalHours)]);
  rows.push(['formations', 'participants', String(s.trainings.participants)]);
  rows.push(['pssf', 'mandats_actifs', String(s.pssf_active_count)]);
  return rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(';')).join('\n');
}

// --- ARG assistée (US-9.3) ---

export interface ArgAnswers {
  activities: string;
  clientele: string;
  geographies: string;
  channels: string;
  volumes: string;
  mitigations: string;
  conclusion: string;
}

export async function createArg(db: Db, ctx: TenantContext, answers: ArgAnswers) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    // Pré-remplissage : statistiques réelles du portefeuille.
    const [clients, matters, assessments] = await Promise.all([
      tx.client.groupBy({ by: ['kind'], _count: true }),
      tx.matter.groupBy({ by: ['category'], _count: true }),
      tx.riskAssessment.groupBy({ by: ['level'], _count: true }),
    ]);
    const stats = {
      clientsByKind: Object.fromEntries(clients.map((c) => [c.kind, c._count])),
      mattersByCategory: Object.fromEntries(matters.map((m) => [m.category, m._count])),
      assessmentsByLevel: Object.fromEntries(assessments.map((a) => [a.level, a._count])),
    };
    const last = await tx.argDocument.findFirst({ orderBy: { version: 'desc' } });
    const version = (last?.version ?? 0) + 1;
    const doc = await tx.argDocument.create({
      data: {
        entityId,
        version,
        answersJson: answers as never,
        statsJson: stats as never,
        conclusion: answers.conclusion,
        createdBy: ctx.userId,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'arg.created',
      objectType: 'arg_document',
      objectId: doc.id,
    });
    return { argId: doc.id, version, stats };
  });
}

export async function listArg(db: Db, ctx: TenantContext) {
  return withTenantContext(db, ctx, (tx) =>
    tx.argDocument.findMany({ orderBy: { version: 'desc' } }),
  );
}

// --- Export contrôle CCBL (US-9.2) : les DOS sont EXCLUES (US-7.4) ---

export async function ccblExport(db: Db, ctx: TenantContext, sampleMatterIds: string[]) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const [entity, args, trainings, pssf, rbe, matters, assessments] = await Promise.all([
      tx.complianceEntity.findUnique({ where: { id: entityId } }),
      tx.argDocument.findMany({ orderBy: { version: 'desc' } }),
      tx.trainingRecord.findMany(),
      tx.pssfMandate.findMany(),
      tx.rbeCheck.findMany(),
      tx.matter.findMany({
        select: {
          id: true,
          title: true,
          scopingVerdict: true,
          category: true,
          status: true,
          openedAt: true,
          closedAt: true,
          frozen: true,
        },
      }),
      tx.riskAssessment.findMany(),
    ]);

    const sample = [];
    for (const matterId of sampleMatterIds) {
      const matter = await tx.matter.findUnique({ where: { id: matterId } });
      if (!matter) continue;
      const client = await tx.client.findUnique({
        where: { id: matter.clientId },
        include: { links: true },
      });
      const documents = await tx.document.findMany({
        where: { ownerType: 'matter', ownerId: matterId },
        select: { id: true, docType: true, fileName: true, checksum: true, createdAt: true },
      });
      const reviews = await tx.periodicReview.findMany({ where: { matterId } });
      const revisions = await tx.scopingRevision.findMany({ where: { matterId } });
      sample.push({ matter, client, documents, reviews, scopingRevisions: revisions });
    }

    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'export.ccbl_generated',
    });
    return {
      generatedAt: new Date().toISOString(),
      entity: { id: entity?.id, name: entity?.name, type: entity?.type },
      argHistory: args,
      registries: { trainings, pssfMandates: pssf, rbeChecks: rbe },
      matters,
      riskAssessments: assessments,
      sampleDossiers: sample,
      note: 'Les DOS sont exclues de cet export (art. cloisonnement, US-7.4).',
    };
  });
}
