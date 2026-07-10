import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenantContext, type Db, type TenantContext } from '../../src/db.js';
import { createOrganization } from '../../src/modules/orgs/service.js';
import { createNaturalClient } from '../../src/modules/clients/service.js';
import { createMatter } from '../../src/modules/matters/service.js';
import {
  assessMatterRisk,
  getRiskMatrix,
  massRecalcRisks,
  updateRiskMatrix,
} from '../../src/modules/risk/service.js';
import { runDailyJobs, shouldRun, type FetchLike } from '../../src/modules/jobs/service.js';
import { annualReport } from '../../src/modules/reports/service.js';
import { annualReportPdf, markdownishPdf } from '../../src/pdf.js';
import { defaultRiskMatrix } from '../../src/config/screening.js';
import { hashPassword, hmacSignHex, hmacVerifyHex } from '../../src/crypto.js';
import { setupTestDb, type TestDb } from './setup.js';

// Sprint 9 : jobs planifiés (fetch simulé), matrice de risque par entité +
// recalcul en masse (US-5.1 CA), PDF serveur, signatures d'URL.

let testDb: TestDb;
let db: Db;
let ctx: TenantContext;

const EU_XML = `<?xml version="1.0"?>
<export><sanctionEntity logicalId="42"><subjectType code="person"/>
<nameAlias wholeName="Igor JOBOV"/><birthdate birthdate="1970-01-01"/></sanctionEntity></export>`;
const UN_XML = `<?xml version="1.0"?>
<CONSOLIDATED_LIST><INDIVIDUALS><INDIVIDUAL><DATAID>1</DATAID>
<FIRST_NAME>Nemo</FIRST_NAME><SECOND_NAME>Nusquam</SECOND_NAME></INDIVIDUAL></INDIVIDUALS></CONSOLIDATED_LIST>`;

const mockFetch: FetchLike = async (url) => ({
  ok: true,
  status: 200,
  text: async () => (url.includes('europa') ? EU_XML : UN_XML),
});

const inScopeAnswers = {
  category: 'real_estate' as const,
  isDefenseOrJudicialProceedings: false,
  isPureLegalConsultation: false,
  assistsInTransaction: true,
  handlesClientFunds: false,
};

beforeAll(async () => {
  testDb = await setupTestDb();
  db = createDb(testDb.appUrl);
  const user = await db.user.create({
    data: { email: 'rc@s9.lu', passwordHash: await hashPassword('Corr3ct-Cheval-Batterie!'), status: 'active' },
  });
  const org = await createOrganization(db, user.id, { name: 'Étude S9', practiceMode: 'individual' });
  ctx = { userId: user.id, entityIds: [org.entities[0]!.id], orgIds: [org.orgId] };
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.close();
});

describe('jobs planifiés (US-5.4/5.6/10.2)', () => {
  it('quotidien : import des deux listes, re-screening de toutes les entités, hit détecté', async () => {
    const { clientId } = await createNaturalClient(db, ctx, {
      firstNames: 'Igor',
      lastName: 'Jobov',
      birthDate: '1970-01-01',
    });
    await createMatter(db, ctx, {
      clientId,
      title: 'Dossier job',
      category: 'real_estate',
      answers: inScopeAnswers,
    });

    const report = await runDailyJobs(db, mockFetch);
    expect(report.lists.map((l) => l.imported)).toEqual([true, true]);
    expect(report.screenedEntities).toBeGreaterThanOrEqual(1);
    expect(report.newHits).toBe(1);
    expect(report.errors).toEqual([]);

    const frozen = await withTenantContext(db, ctx, (tx) => tx.matter.count({ where: { frozen: true } }));
    expect(frozen).toBe(1);
  });

  it('relance : listes inchangées → pas de réimport, pas de re-screening inutile', async () => {
    const report = await runDailyJobs(db, mockFetch);
    expect(report.lists.every((l) => !l.imported)).toBe(true);
    expect(report.screenedEntities).toBe(0);
  });

  it('hebdo forcé : re-screening même sans nouvelle liste, idempotent sur les hits', async () => {
    const report = await runDailyJobs(db, mockFetch, { forceRescreen: true });
    expect(report.screenedEntities).toBeGreaterThanOrEqual(1);
    expect(report.newHits).toBe(0);
  });

  it('erreur de téléchargement : rapportée sans stopper le job', async () => {
    const failingFetch: FetchLike = async (url) =>
      url.includes('europa')
        ? { ok: false, status: 503, text: async () => '' }
        : { ok: true, status: 200, text: async () => UN_XML };
    const report = await runDailyJobs(db, failingFetch);
    expect(report.lists.find((l) => l.source === 'EU')?.error).toBe('HTTP 503');
  });

  it('shouldRun : déduplique par période', async () => {
    expect(await shouldRun(db, 'test_job', 24)).toBe(true);
    expect(await shouldRun(db, 'test_job', 24)).toBe(false);
  });
});

describe('matrice de risque par entité (US-5.1)', () => {
  it('par défaut : matrice standard ; refus d’une matrice sans les facteurs forcés', async () => {
    const current = await getRiskMatrix(db, ctx);
    expect(current.isDefault).toBe(true);
    const crippled = {
      ...defaultRiskMatrix(),
      factors: defaultRiskMatrix().factors.filter((f) => f.id !== 'pep'),
    };
    await expect(updateRiskMatrix(db, ctx, crippled)).rejects.toMatchObject({
      code: 'invalid_matrix',
    });
  });

  it('personnalisation valide + recalcul en masse avec rapport de différences', async () => {
    const { clientId } = await createNaturalClient(db, ctx, { firstNames: 'Neutre', lastName: 'Client' });
    const m = await createMatter(db, ctx, {
      clientId,
      title: 'Dossier immobilier simple',
      category: 'real_estate',
      answers: inScopeAnswers,
    });
    const before = await assessMatterRisk(db, ctx, m.matterId);
    expect(before.level).toBe('low'); // immobilier +2 < seuil moyen 4

    // Le RC durcit l'immobilier : +6 points → moyen.
    const custom = structuredClone(defaultRiskMatrix()) as ReturnType<typeof defaultRiskMatrix>;
    const realEstate = custom.factors.find((f) => f.id === 'real_estate')!;
    (realEstate as { points?: number }).points = 6;
    const updated = await updateRiskMatrix(db, ctx, custom);
    expect(updated.version).toBe(1);

    const recalc = await massRecalcRisks(db, ctx);
    expect(recalc.reassessed).toBeGreaterThanOrEqual(1);
    const change = recalc.changes.find((c) => c.matterId === m.matterId);
    expect(change).toMatchObject({ before: 'low', after: 'medium' });

    // L'instantané de la nouvelle évaluation porte la version personnalisée.
    const latest = await withTenantContext(db, ctx, (tx) =>
      tx.riskAssessment.findFirst({ where: { matterId: m.matterId }, orderBy: { createdAt: 'desc' } }),
    );
    expect(latest!.matrixVersion).toContain('-v1');
  });
});

describe('digest hebdomadaire (US-6.2)', () => {
  it('envoyé aux owner/compliance de chaque entité, comptages uniquement', async () => {
    const { NoopMailer } = await import('../../src/mailer.js');
    const { sendWeeklyDigests } = await import('../../src/modules/jobs/service.js');
    const mailer = new NoopMailer();
    const result = await sendWeeklyDigests(db, mailer);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const mail = mailer.sent[0]!;
    expect(mail.to).toContain('rc@s9.lu');
    expect(mail.text).toContain('alerte');
    // Anti-fuite : aucun nom de client du portefeuille dans l'e-mail.
    expect(mail.text).not.toContain('Jobov');
  });
});

describe('PDF serveur & signatures', () => {
  it('rapport annuel : PDF valide généré', async () => {
    const report = await annualReport(db, ctx, 2026);
    const pdf = await annualReportPdf('Étude S9', report);
    expect(Buffer.from(pdf.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it('dossier markdown → PDF', async () => {
    const pdf = await markdownishPdf('Titre', '## Section\nContenu **important**.\n> Note');
    expect(Buffer.from(pdf.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('HMAC : signature vérifiée, altération et mauvaise clé rejetées', () => {
    const key = 'a'.repeat(64);
    const sig = hmacSignHex(key, 'doc|entity|123');
    expect(hmacVerifyHex(key, 'doc|entity|123', sig)).toBe(true);
    expect(hmacVerifyHex(key, 'doc|entity|124', sig)).toBe(false);
    expect(hmacVerifyHex('b'.repeat(64), 'doc|entity|123', sig)).toBe(false);
  });
});
