import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { StorageAdapter } from '../storage.js';
import { requireEntityAction } from '../entityAuth.js';
import { badRequest } from '../errors.js';
import {
  addClientLink,
  createLegalClient,
  createNaturalClient,
  listClients,
} from '../modules/clients/service.js';
import {
  activateMatter,
  closeMatter,
  createMatter,
  listMatters,
  requalifyMatter,
} from '../modules/matters/service.js';
import { expiringDocuments, uploadDocument } from '../modules/documents/service.js';
import { decideHit, importList, listOpenAlerts, runScreening } from '../modules/screening/service.js';
import { assessMatterRisk, overrideMatterRisk } from '../modules/risk/service.js';
import { completePeriodicReview, todoBoard } from '../modules/vigilance/service.js';
import {
  batonnierDossier,
  createSuspicionReport,
  decideSuspicionReport,
  listSuspicionReports,
  recordBatonnierTransmission,
  type DosDeps,
} from '../modules/dos/service.js';
import {
  addPssfMandate,
  addRbeCheck,
  addTraining,
  decisionsRegistry,
  endPssfMandate,
  listPssfMandates,
  listRbeChecks,
  listTrainings,
} from '../modules/registries/service.js';
import {
  annualReport,
  annualReportCsv,
  ccblExport,
  createArg,
  listArg,
} from '../modules/reports/service.js';
import {
  importClientsCsv,
  reversibilityExport,
  runPurge,
  setLegalHold,
} from '../modules/retention/service.js';
import {
  getRiskMatrix,
  massRecalcRisks,
  updateRiskMatrix,
} from '../modules/risk/service.js';
import { runDailyJobs } from '../modules/jobs/service.js';
import { annualReportPdf, argPdf, markdownishPdf } from '../pdf.js';
import { encryptedArchive } from '../archive.js';
import {
  createPortalLink,
  decideSubmission,
  listSubmissions,
  portalConfirmBe,
  portalUpload,
  portalView,
} from '../modules/portal/service.js';
import { deriveEntityKeyHex, hmacSignHex, hmacVerifyHex } from '../crypto.js';
import { SYSTEM_ACTOR, withTenantContext } from '../db.js';
import { can } from '../permissions.js';
import { forbidden, notFound } from '../errors.js';

// Routes tenant-scopées : chaque handler passe par requireEntityAction (rôle +
// permission, US-1.3) qui construit le contexte RLS restreint à l'entité visée.

const personSchema = z.object({
  firstNames: z.string().min(1).max(200),
  lastName: z.string().min(1).max(200),
  birthDate: z.string().date().optional(),
  birthPlace: z.string().max(200).optional(),
  nationalities: z.array(z.string().length(2)).max(10).optional(),
  address: z.record(z.unknown()).optional(),
  idNumber: z.string().max(100).optional(),
  profession: z.string().max(200).optional(),
  pepStatus: z.enum(['not_pep', 'pep', 'family_member', 'close_associate']).optional(),
});

const legalSchema = z.object({
  name: z.string().min(1).max(300),
  form: z.string().max(100).optional(),
  rcsNumber: z.string().max(50).optional(),
  country: z.string().length(2),
  address: z.record(z.unknown()).optional(),
  activity: z.string().max(500).optional(),
  activityCountries: z.array(z.string().length(2)).max(30).optional(),
  kind: z.enum(['legal', 'arrangement']).optional(),
});

const linkSchema = z.object({
  role: z.enum([
    'beneficial_owner',
    'representative',
    'principal_director',
    'settlor',
    'trustee',
    'protector',
    'beneficiary',
  ]),
  person: personSchema,
  ownershipPct: z.number().min(0).max(100).optional(),
  controlNature: z.string().max(500).optional(),
  justification: z.string().max(2000).optional(),
  verified: z.boolean().optional(),
});

const scopingAnswersSchema = z.object({
  category: z.enum([
    'real_estate',
    'company_formation',
    'pssf',
    'family_office',
    'tax_advice',
    'asset_management',
    'funds_of_third_parties',
    'litigation',
    'consultation',
    'other',
  ]),
  isDefenseOrJudicialProceedings: z.boolean(),
  isPureLegalConsultation: z.boolean(),
  assistsInTransaction: z.boolean(),
  handlesClientFunds: z.boolean(),
});

const matterSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(1).max(300),
  category: scopingAnswersSchema.shape.category,
  answers: scopingAnswersSchema,
  fundsOrigin: z.string().max(200).optional(),
  fundsOriginNote: z.string().max(2000).optional(),
  countries: z.array(z.string().length(2)).max(50).optional(),
  estVolume: z.string().max(100).optional(),
  remoteRelationship: z.boolean().optional(),
  thirdPartyIntroducer: z.boolean().optional(),
});

const requalifySchema = z.object({
  answers: scopingAnswersSchema,
  reason: z.string().min(1).max(2000),
});

const uploadMetaSchema = z.object({
  ownerType: z.enum(['person', 'legal_party', 'client', 'matter', 'entity']),
  ownerId: z.string().uuid(),
  docType: z.string().min(1).max(100),
  expiresAt: z.string().date().optional(),
  issuedAt: z.string().date().optional(),
});

const entityParams = z.object({ entityId: z.string().uuid() });
const matterParams = z.object({ entityId: z.string().uuid(), matterId: z.string().uuid() });
const clientParams = z.object({ entityId: z.string().uuid(), clientId: z.string().uuid() });

export interface EntityRouteDeps {
  db: Db;
  storage: StorageAdapter;
  encKeyHex: string;
}

export function registerEntityRoutes(app: FastifyInstance, deps: EntityRouteDeps): void {
  const { db, storage } = deps;
  const dosDeps: DosDeps = { db, encKeyHex: deps.encKeyHex };

  // --- Clients (M3) ---
  app.post('/api/v1/entities/:entityId/clients/natural', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.write');
    const body = personSchema.parse(req.body);
    return reply.status(201).send(await createNaturalClient(db, ctx, body));
  });

  app.post('/api/v1/entities/:entityId/clients/legal', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.write');
    const body = legalSchema.parse(req.body);
    return reply.status(201).send(await createLegalClient(db, ctx, body));
  });

  app.get('/api/v1/entities/:entityId/clients', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.read');
    return listClients(db, ctx);
  });

  app.post('/api/v1/entities/:entityId/clients/:clientId/links', async (req, reply) => {
    const { entityId, clientId } = clientParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.write');
    const body = linkSchema.parse(req.body);
    return reply.status(201).send(await addClientLink(db, ctx, clientId, body));
  });

  // --- Dossiers (M4) ---
  app.post('/api/v1/entities/:entityId/matters', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'matter.write');
    const body = matterSchema.parse(req.body);
    return reply.status(201).send(await createMatter(db, ctx, body));
  });

  app.get('/api/v1/entities/:entityId/matters', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'matter.read');
    return listMatters(db, ctx);
  });

  app.post('/api/v1/entities/:entityId/matters/:matterId/activate', async (req) => {
    const { entityId, matterId } = matterParams.parse(req.params);
    const { ctx, role } = await requireEntityAction(db, req.userId!, entityId, 'matter.write');
    return activateMatter(db, ctx, matterId, {
      canApproveHighRisk: can(role, 'matter.activate_high_risk'),
    });
  });

  app.post('/api/v1/entities/:entityId/matters/:matterId/requalify', async (req) => {
    const { entityId, matterId } = matterParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'matter.write');
    const body = requalifySchema.parse(req.body);
    return requalifyMatter(db, ctx, matterId, body.answers, body.reason);
  });

  app.post('/api/v1/entities/:entityId/matters/:matterId/close', async (req) => {
    const { entityId, matterId } = matterParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'matter.write');
    return closeMatter(db, ctx, matterId);
  });

  // --- Documents (M3) — multipart : champ `file` + champs métadonnées ---
  app.post('/api/v1/entities/:entityId/documents', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.write');
    const file = await req.file();
    if (!file) throw badRequest('file_required');
    const data = await file.toBuffer();
    const fields = Object.fromEntries(
      Object.entries(file.fields).flatMap(([k, v]) =>
        v && 'value' in (v as object) ? [[k, (v as { value: string }).value]] : [],
      ),
    );
    const meta = uploadMetaSchema.parse(fields);
    const result = await uploadDocument(db, storage, ctx, {
      ...meta,
      fileName: file.filename,
      data,
    });
    return reply.status(201).send(result);
  });

  app.get('/api/v1/entities/:entityId/documents/expiring', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.read');
    const query = z.object({ days: z.coerce.number().int().positive().max(3650).optional() }).parse(req.query);
    return expiringDocuments(db, ctx, query.days);
  });

  // --- Screening & alertes (M5) ---
  app.post('/api/v1/entities/:entityId/screening/run', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'screening.run');
    return runScreening(db, ctx);
  });

  app.get('/api/v1/entities/:entityId/alerts', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.read');
    return listOpenAlerts(db, ctx);
  });

  app.post('/api/v1/entities/:entityId/alerts/:hitId/decide', async (req) => {
    const params = z
      .object({ entityId: z.string().uuid(), hitId: z.string().uuid() })
      .parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'screening.decide');
    const body = z
      .object({
        decision: z.enum(['false_positive', 'confirmed']),
        reason: z.string().min(1).max(2000),
      })
      .parse(req.body);
    return decideHit(db, ctx, params.hitId, body.decision, body.reason);
  });

  // --- Risque (M5) ---
  app.post('/api/v1/entities/:entityId/matters/:matterId/assess-risk', async (req) => {
    const { entityId, matterId } = matterParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'risk.assess');
    return assessMatterRisk(db, ctx, matterId);
  });

  app.post('/api/v1/entities/:entityId/matters/:matterId/override-risk', async (req) => {
    const { entityId, matterId } = matterParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'risk.override');
    const body = z
      .object({ level: z.enum(['low', 'medium', 'high']), reason: z.string().min(1).max(2000) })
      .parse(req.body);
    return overrideMatterRisk(db, ctx, matterId, body.level, body.reason);
  });

  // --- Vigilance continue (M6) ---
  app.get('/api/v1/entities/:entityId/todo', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'matter.read');
    return todoBoard(db, ctx);
  });

  app.post('/api/v1/entities/:entityId/matters/:matterId/review', async (req) => {
    const { entityId, matterId } = matterParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'matter.write');
    const body = z
      .object({
        checklist: z.object({
          identityStillValid: z.boolean(),
          beneficialOwnersUnchanged: z.boolean(),
          activityConsistent: z.boolean(),
        }),
        notes: z.string().max(4000).optional(),
      })
      .parse(req.body);
    return completePeriodicReview(db, ctx, matterId, body.checklist, body.notes);
  });

  // --- DOS (M7, cloisonnée) ---
  app.post('/api/v1/entities/:entityId/matters/:matterId/suspicion', async (req, reply) => {
    const { entityId, matterId } = matterParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'dos.create');
    const body = z.object({ description: z.string().min(1).max(20000) }).parse(req.body);
    const ack = await createSuspicionReport(dosDeps, ctx, matterId, body.description);
    return reply.status(201).send(ack);
  });

  app.get('/api/v1/entities/:entityId/dos', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'dos.read');
    return listSuspicionReports(dosDeps, ctx);
  });

  app.post('/api/v1/entities/:entityId/dos/:reportId/decide', async (req) => {
    const params = z
      .object({ entityId: z.string().uuid(), reportId: z.string().uuid() })
      .parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'dos.decide');
    const body = z
      .object({
        decision: z.enum(['declared', 'no_declaration']),
        reason: z.string().min(1).max(4000),
      })
      .parse(req.body);
    return decideSuspicionReport(dosDeps, ctx, params.reportId, body.decision, body.reason);
  });

  app.get('/api/v1/entities/:entityId/dos/:reportId/batonnier-dossier', async (req, reply) => {
    const params = z
      .object({ entityId: z.string().uuid(), reportId: z.string().uuid() })
      .parse(req.params);
    const query = z.object({ format: z.enum(['json', 'pdf']).default('json') }).parse(req.query);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'dos.read');
    const dossier = await batonnierDossier(dosDeps, ctx, params.reportId);
    if (query.format === 'pdf') {
      const pdf = await markdownishPdf(
        'Déclaration d’opération suspecte — transmission au Bâtonnier',
        dossier.markdown,
      );
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', 'attachment; filename="dos-batonnier.pdf"')
        .send(Buffer.from(pdf));
    }
    return dossier;
  });

  app.post('/api/v1/entities/:entityId/dos/:reportId/batonnier', async (req) => {
    const params = z
      .object({ entityId: z.string().uuid(), reportId: z.string().uuid() })
      .parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'dos.decide');
    const body = z
      .object({ sentAt: z.string().date(), goamlRef: z.string().max(100).optional() })
      .parse(req.body);
    return recordBatonnierTransmission(dosDeps, ctx, params.reportId, body);
  });

  // --- Registres (M8) ---
  app.post('/api/v1/entities/:entityId/registries/trainings', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'registry.write');
    const body = z
      .object({
        personLabel: z.string().min(1).max(200),
        trainingDate: z.string().date(),
        title: z.string().min(1).max(300),
        hours: z.number().positive().max(200),
        organism: z.string().max(200).optional(),
        attestationDocId: z.string().uuid().optional(),
      })
      .parse(req.body);
    return reply.status(201).send(await addTraining(db, ctx, body));
  });

  app.get('/api/v1/entities/:entityId/registries/trainings', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'registry.read');
    const query = z.object({ year: z.coerce.number().int().optional() }).parse(req.query);
    return listTrainings(db, ctx, query.year);
  });

  app.post('/api/v1/entities/:entityId/registries/pssf', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'registry.write');
    const body = z
      .object({
        companyName: z.string().min(1).max(300),
        function: z.string().min(1).max(200),
        startDate: z.string().date(),
        endDate: z.string().date().optional(),
        matterId: z.string().uuid().optional(),
      })
      .parse(req.body);
    return reply.status(201).send(await addPssfMandate(db, ctx, body));
  });

  app.get('/api/v1/entities/:entityId/registries/pssf', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'registry.read');
    return listPssfMandates(db, ctx);
  });

  app.post('/api/v1/entities/:entityId/registries/pssf/:mandateId/end', async (req) => {
    const params = z
      .object({ entityId: z.string().uuid(), mandateId: z.string().uuid() })
      .parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'registry.write');
    const body = z.object({ endDate: z.string().date() }).parse(req.body);
    return endPssfMandate(db, ctx, params.mandateId, body.endDate);
  });

  app.post('/api/v1/entities/:entityId/registries/rbe', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'registry.write');
    const body = z
      .object({
        clientId: z.string().uuid(),
        checkedAt: z.string().date(),
        extractDocId: z.string().uuid().optional(),
        divergence: z.boolean().optional(),
        divergenceDetails: z.string().max(4000).optional(),
        decision: z.string().max(2000).optional(),
        reported: z.boolean().optional(),
        reportedAt: z.string().date().optional(),
      })
      .parse(req.body);
    return reply.status(201).send(await addRbeCheck(db, ctx, body));
  });

  app.get('/api/v1/entities/:entityId/registries/rbe', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'registry.read');
    return listRbeChecks(db, ctx);
  });

  app.get('/api/v1/entities/:entityId/registries/decisions', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx, role } = await requireEntityAction(db, req.userId!, entityId, 'registry.read');
    return decisionsRegistry(db, ctx, can(role, 'dos.read'));
  });

  // --- Rapports & ARG (M9) ---
  app.get('/api/v1/entities/:entityId/reports/annual', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'report.generate');
    const query = z
      .object({
        year: z.coerce.number().int().min(2020).max(2100),
        format: z.enum(['json', 'csv', 'pdf']).default('json'),
      })
      .parse(req.query);
    const report = await annualReport(db, ctx, query.year);
    if (query.format === 'csv') {
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="questionnaire-${query.year}.csv"`)
        .send(annualReportCsv(report));
    }
    if (query.format === 'pdf') {
      const entity = await withTenantContext(db, ctx, (tx) =>
        tx.complianceEntity.findUnique({ where: { id: entityId } }),
      );
      const pdf = await annualReportPdf(entity?.name ?? 'Entité', report);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="questionnaire-${query.year}.pdf"`)
        .send(Buffer.from(pdf));
    }
    return report;
  });

  app.get('/api/v1/entities/:entityId/arg/:argId/pdf', async (req, reply) => {
    const params = z
      .object({ entityId: z.string().uuid(), argId: z.string().uuid() })
      .parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'report.generate');
    const data = await withTenantContext(db, ctx, async (tx) => ({
      arg: await tx.argDocument.findUnique({ where: { id: params.argId } }),
      entity: await tx.complianceEntity.findUnique({ where: { id: params.entityId } }),
    }));
    if (!data.arg) throw notFound('ARG inconnue');
    const pdf = await argPdf(
      data.entity?.name ?? 'Entité',
      data.arg.version,
      data.arg.answersJson as Record<string, string>,
      data.arg.statsJson as Record<string, Record<string, number>>,
      data.arg.createdAt.toISOString().slice(0, 10),
    );
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="arg-v${data.arg.version}.pdf"`)
      .send(Buffer.from(pdf));
  });

  app.post('/api/v1/entities/:entityId/arg', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'report.generate');
    const body = z
      .object({
        activities: z.string().min(1).max(8000),
        clientele: z.string().min(1).max(8000),
        geographies: z.string().min(1).max(8000),
        channels: z.string().min(1).max(8000),
        volumes: z.string().min(1).max(8000),
        mitigations: z.string().min(1).max(8000),
        conclusion: z.string().min(1).max(8000),
      })
      .parse(req.body);
    return reply.status(201).send(await createArg(db, ctx, body));
  });

  app.get('/api/v1/entities/:entityId/arg', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'report.generate');
    return listArg(db, ctx);
  });

  app.post('/api/v1/entities/:entityId/exports/ccbl', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'export.ccbl');
    const body = z
      .object({ sampleMatterIds: z.array(z.string().uuid()).max(500).default([]) })
      .parse(req.body ?? {});
    return ccblExport(db, ctx, body.sampleMatterIds);
  });

  // Archive chiffrée de l'export CCBL (US-9.2) : tar.gz + AES-256-GCM,
  // clé dérivée d'une phrase de passe jamais stockée. Inclut les pièces
  // binaires des dossiers échantillonnés.
  app.post('/api/v1/entities/:entityId/exports/ccbl/archive', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'export.ccbl');
    const body = z
      .object({
        passphrase: z.string().min(12).max(512),
        sampleMatterIds: z.array(z.string().uuid()).max(500).default([]),
      })
      .parse(req.body);
    const dump = await ccblExport(db, ctx, body.sampleMatterIds);

    const files: { name: string; data: Buffer }[] = [
      { name: 'export.json', data: Buffer.from(JSON.stringify(dump, null, 2), 'utf8') },
      {
        name: 'README.txt',
        data: Buffer.from(
          [
            'LexKYC — export contrôle CCBL (archive chiffrée)',
            `Généré le ${dump.generatedAt} pour ${dump.entity.name}.`,
            '',
            'Contenu : export.json (ARG, registres, dossiers, évaluations) +',
            'pièces des dossiers échantillonnés sous documents/.',
            'Les DOS sont exclues (cloisonnement, US-7.4).',
            '',
            'Déchiffrement : AES-256-GCM, clé scrypt dérivée de la phrase de passe',
            'communiquée séparément. Format: LEXKYC1|salt16|iv12|tag16|gzip(tar).',
          ].join('\n'),
          'utf8',
        ),
      },
    ];
    for (const dossier of dump.sampleDossiers) {
      for (const doc of dossier.documents) {
        const full = await withTenantContext(db, ctx, (tx) =>
          tx.document.findUnique({ where: { id: doc.id } }),
        );
        if (!full) continue;
        try {
          files.push({
            name: `documents/${dossier.matter?.id}/${full.fileName}`,
            data: await storage.get(full.storageKey),
          });
        } catch {
          // Pièce absente du stockage : signalé dans l'archive plutôt qu'échec silencieux.
          files.push({
            name: `documents/${dossier.matter?.id}/${full.fileName}.MANQUANT.txt`,
            data: Buffer.from(`Pièce introuvable dans le stockage (clé ${full.storageKey}).`),
          });
        }
      }
    }
    const archive = encryptedArchive(files, body.passphrase);
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', 'attachment; filename="export-ccbl.tar.gz.enc"')
      .send(archive);
  });

  // --- Conservation, purge, réversibilité, import (M10) ---
  app.post('/api/v1/entities/:entityId/matters/:matterId/legal-hold', async (req) => {
    const { entityId, matterId } = matterParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'retention.legal_hold');
    const body = z
      .object({ hold: z.boolean(), reason: z.string().max(2000).optional() })
      .parse(req.body);
    return setLegalHold(db, ctx, matterId, body.hold, body.reason);
  });

  app.post('/api/v1/entities/:entityId/purge/run', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'retention.legal_hold');
    return runPurge(db, ctx);
  });

  app.get('/api/v1/entities/:entityId/exports/reversibility', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'export.reversibility');
    return reversibilityExport(db, ctx);
  });

  app.post('/api/v1/entities/:entityId/import/clients-csv', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.write');
    const body = z.object({ csv: z.string().min(1).max(2_000_000) }).parse(req.body);
    return importClientsCsv(db, ctx, body.csv);
  });

  // --- Matrice de risque de l'entité (US-5.1) ---
  app.get('/api/v1/entities/:entityId/risk-matrix', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'risk.assess');
    return getRiskMatrix(db, ctx);
  });

  app.put('/api/v1/entities/:entityId/risk-matrix', async (req, reply) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'entity.settings.manage');
    return reply.status(201).send(await updateRiskMatrix(db, ctx, req.body));
  });

  app.post('/api/v1/entities/:entityId/risk-matrix/recalc', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'entity.settings.manage');
    return massRecalcRisks(db, ctx);
  });

  // --- Consultation des pièces : URLs signées à durée courte (§ D.5-5) ---
  const FILE_LINK_TTL_S = 300;
  const fileKey = () => deriveEntityKeyHex(deps.encKeyHex, 'global', 'files');

  app.post('/api/v1/entities/:entityId/documents/:docId/link', async (req) => {
    const params = z
      .object({ entityId: z.string().uuid(), docId: z.string().uuid() })
      .parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'client.read');
    const doc = await withTenantContext(db, ctx, (tx) =>
      tx.document.findUnique({ where: { id: params.docId } }),
    );
    if (!doc) throw notFound('document inconnu');
    const exp = Math.floor(Date.now() / 1000) + FILE_LINK_TTL_S;
    const sig = hmacSignHex(fileKey(), `${params.docId}|${params.entityId}|${exp}`);
    return {
      path: `/api/v1/files/${params.docId}?e=${params.entityId}&x=${exp}&s=${sig}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  });

  // Route publique : l'autorisation EST la signature (courte durée, non rejouable après expiry).
  app.get('/api/v1/files/:docId', async (req, reply) => {
    const params = z.object({ docId: z.string().uuid() }).parse(req.params);
    const query = z
      .object({ e: z.string().uuid(), x: z.coerce.number().int(), s: z.string().length(64) })
      .parse(req.query);
    if (query.x < Math.floor(Date.now() / 1000)) throw forbidden('lien expiré');
    if (!hmacVerifyHex(fileKey(), `${params.docId}|${query.e}|${query.x}`, query.s)) {
      throw forbidden('signature invalide');
    }
    const doc = await withTenantContext(
      db,
      { userId: SYSTEM_ACTOR, entityIds: [query.e], orgIds: [] },
      (tx) => tx.document.findUnique({ where: { id: params.docId } }),
    );
    if (!doc) throw notFound('document inconnu');
    const data = await storage.get(doc.storageKey);
    return reply
      .header('content-type', doc.mimeType)
      .header('content-disposition', `inline; filename="${doc.fileName.replaceAll('"', '')}"`)
      .header('cache-control', 'private, no-store')
      .send(data);
  });

  // --- Portail client (M11) ---
  app.post('/api/v1/entities/:entityId/clients/:clientId/portal-link', async (req, reply) => {
    const { entityId, clientId } = clientParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.write');
    return reply.status(201).send(await createPortalLink(db, ctx, clientId));
  });

  app.get('/api/v1/entities/:entityId/portal-submissions', async (req) => {
    const { entityId } = entityParams.parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, entityId, 'client.read');
    return listSubmissions(db, ctx);
  });

  app.post('/api/v1/entities/:entityId/portal-submissions/:submissionId/decide', async (req) => {
    const params = z
      .object({ entityId: z.string().uuid(), submissionId: z.string().uuid() })
      .parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'client.write');
    const body = z.object({ decision: z.enum(['accepted', 'rejected']) }).parse(req.body);
    return decideSubmission(db, ctx, params.submissionId, body.decision);
  });

  // Routes PUBLIQUES du portail : l'autorisation est le lien magique (jeton
  // haché en base, TTL 7 jours) ; rate-limit serré.
  const portalLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
  const portalQuery = z.object({ e: z.string().uuid(), t: z.string().min(20).max(100) });

  app.get('/api/v1/portal', portalLimit, async (req) => {
    const { e, t } = portalQuery.parse(req.query);
    return portalView(db, e, t);
  });

  app.post('/api/v1/portal/documents', portalLimit, async (req, reply) => {
    const { e, t } = portalQuery.parse(req.query);
    const file = await req.file();
    if (!file) throw badRequest('file_required');
    const data = await file.toBuffer();
    const fields = Object.fromEntries(
      Object.entries(file.fields).flatMap(([k, v]) =>
        v && 'value' in (v as object) ? [[k, (v as { value: string }).value]] : [],
      ),
    );
    const meta = z
      .object({ docType: z.string().min(1).max(50), consent: z.enum(['true', 'false']) })
      .parse(fields);
    const result = await portalUpload(db, storage, e, t, {
      docType: meta.docType,
      fileName: file.filename,
      data,
      consent: meta.consent === 'true',
    });
    return reply.status(201).send(result);
  });

  app.post('/api/v1/portal/be-confirmation', portalLimit, async (req, reply) => {
    const { e, t } = portalQuery.parse(req.query);
    const body = z
      .object({
        confirmed: z.boolean(),
        comment: z.string().max(4000).optional(),
        consent: z.literal(true),
      })
      .parse(req.body);
    return reply.status(201).send(await portalConfirmBe(db, e, t, body));
  });

  // --- Jobs planifiés : déclenchement manuel (plateforme) ---
  app.post('/api/v1/admin/jobs/run-daily', async (req) => {
    const user = await db.user.findUnique({ where: { id: req.userId! } });
    if (!user?.isPlatformAdmin) throw forbidden('réservé au support plateforme');
    const body = z.object({ forceRescreen: z.boolean().default(false) }).parse(req.body ?? {});
    return runDailyJobs(db, fetch, { forceRescreen: body.forceRescreen });
  });

  // --- Import des listes de sanctions (plateforme, US-5.4) ---
  // Données publiques mondiales : réservé au support éditeur (is_platform_admin),
  // qui n'accède jamais aux données métier — les listes n'en sont pas.
  app.post('/api/v1/admin/lists/import', async (req, reply) => {
    const user = await db.user.findUnique({ where: { id: req.userId! } });
    if (!user?.isPlatformAdmin) throw forbidden('réservé au support plateforme');
    const file = await req.file();
    if (!file) throw badRequest('file_required');
    const fields = Object.fromEntries(
      Object.entries(file.fields).flatMap(([k, v]) =>
        v && 'value' in (v as object) ? [[k, (v as { value: string }).value]] : [],
      ),
    );
    const { source } = z.object({ source: z.enum(['EU', 'UN']) }).parse(fields);
    const xml = (await file.toBuffer()).toString('utf8');
    const result = await importList(db, source, xml);
    return reply.status(result.skipped ? 200 : 201).send(result);
  });
}
