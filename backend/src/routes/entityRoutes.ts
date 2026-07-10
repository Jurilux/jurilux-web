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
import { can } from '../permissions.js';
import { forbidden } from '../errors.js';

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

  app.get('/api/v1/entities/:entityId/dos/:reportId/batonnier-dossier', async (req) => {
    const params = z
      .object({ entityId: z.string().uuid(), reportId: z.string().uuid() })
      .parse(req.params);
    const { ctx } = await requireEntityAction(db, req.userId!, params.entityId, 'dos.read');
    return batonnierDossier(dosDeps, ctx, params.reportId);
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
