import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenantContext, type Db, type TenantContext } from '../../src/db.js';
import { createOrganization } from '../../src/modules/orgs/service.js';
import { createNaturalClient } from '../../src/modules/clients/service.js';
import { closeMatter, createMatter } from '../../src/modules/matters/service.js';
import { assessMatterRisk } from '../../src/modules/risk/service.js';
import { addTraining } from '../../src/modules/registries/service.js';
import { annualReport, annualReportCsv, ccblExport, createArg } from '../../src/modules/reports/service.js';
import {
  importClientsCsv,
  reversibilityExport,
  runPurge,
  setLegalHold,
} from '../../src/modules/retention/service.js';
import { uploadDocument } from '../../src/modules/documents/service.js';
import { hashPassword } from '../../src/crypto.js';
import { setupTestDb, type TestDb } from './setup.js';
import type { StorageAdapter } from '../../src/storage.js';

// Sprints 7-8 : M9 rapport annuel / ARG / export CCBL, M10 purge (CA n°6),
// gel légal, réversibilité, import CSV.

let testDb: TestDb;
let db: Db;
let ctx: TenantContext;

class MemoryStorage implements StorageAdapter {
  async put() {}
  async get() {
    return Buffer.alloc(0);
  }
}

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
    data: { email: 'rc@rapport.lu', passwordHash: await hashPassword('Corr3ct-Cheval-Batterie!'), status: 'active' },
  });
  const org = await createOrganization(db, user.id, { name: 'Étude Rapports', practiceMode: 'individual' });
  ctx = { userId: user.id, entityIds: [org.entities[0]!.id], orgIds: [org.orgId] };
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.close();
});

describe('M9 — rapport annuel & ARG & export CCBL', () => {
  it('rapport annuel : agrégats traçables + CSV', async () => {
    const { clientId } = await createNaturalClient(db, ctx, {
      firstNames: 'Anne',
      lastName: 'Majerus',
      nationalities: ['LU'],
      pepStatus: 'pep',
    });
    const m = await createMatter(db, ctx, {
      clientId,
      title: 'Vente immeuble',
      category: 'real_estate',
      answers: inScopeAnswers,
      fundsOrigin: 'épargne',
      countries: ['LU'],
      estVolume: '500k',
    });
    await assessMatterRisk(db, ctx, m.matterId);
    await addTraining(db, ctx, {
      personLabel: 'Me RC',
      trainingDate: '2026-02-01',
      title: 'LBC/FT annuelle',
      hours: 4,
    });

    const report = await annualReport(db, ctx, 2026);
    expect(report.sections.matters_total.opened.count).toBe(1);
    expect(report.sections.matters_total.opened.matterIds).toContain(m.matterId);
    expect(report.sections.matters_in_scope_by_category.real_estate?.count).toBe(1);
    expect(report.sections.pep_count).toBe(1);
    expect(report.sections.vigilance_measures.enhanced.count).toBe(1); // PEP → élevé forcé
    expect(report.sections.trainings.totalHours).toBe(4);
    expect(report.sections.clients_by_country.LU).toBe(1);

    const csv = annualReportCsv(report);
    expect(csv).toContain('"pep";"nombre";"1"');
    expect(csv).toContain('"vigilance";"renforcee";"1"');
  });

  it('ARG : versionnée, pré-remplie avec les stats réelles', async () => {
    const answers = {
      activities: 'Immobilier et sociétés',
      clientele: 'PP résidentes et PM locales',
      geographies: 'LU, UE',
      channels: 'Relation en présentiel',
      volumes: '< 5 M€/an',
      mitigations: 'Procédure interne, screening systématique',
      conclusion: 'Risque global : moyen',
    };
    const v1 = await createArg(db, ctx, answers);
    expect(v1.version).toBe(1);
    expect(v1.stats.mattersByCategory.real_estate).toBe(1);
    const v2 = await createArg(db, ctx, answers);
    expect(v2.version).toBe(2);
  });

  it('export CCBL : ARG + registres + dossiers + échantillon, DOS exclues', async () => {
    const matters = await withTenantContext(db, ctx, (tx) => tx.matter.findMany());
    const dump = await ccblExport(db, ctx, [matters[0]!.id]);
    expect(dump.argHistory.length).toBe(2);
    expect(dump.sampleDossiers).toHaveLength(1);
    expect(dump.matters.length).toBeGreaterThan(0);
    expect(JSON.stringify(dump)).not.toContain('suspicion');
  });
});

describe('M10 — purge à 5 ans (CA n°6), gel légal, réversibilité, import CSV', () => {
  let purgeableMatterId: string;
  let heldMatterId: string;
  let purgeableClientId: string;

  it('préparation : deux dossiers clos à échéance, un sous gel légal', async () => {
    const storage = new MemoryStorage();
    const mk = async (name: string) => {
      const { clientId, personId } = await createNaturalClient(db, ctx, {
        firstNames: name,
        lastName: 'Purgeable',
        idNumber: 'ID-SECRET-123',
      });
      const m = await createMatter(db, ctx, {
        clientId,
        title: `Dossier ${name}`,
        category: 'consultation',
        answers: {
          category: 'consultation',
          isDefenseOrJudicialProceedings: false,
          isPureLegalConsultation: true,
          assistsInTransaction: false,
          handlesClientFunds: false,
        },
      });
      await uploadDocument(db, storage, ctx, {
        ownerType: 'matter',
        ownerId: m.matterId,
        docType: 'contract',
        fileName: 'piece.pdf',
        data: Buffer.from('%PDF-1.7 pièce'),
      });
      await closeMatter(db, ctx, m.matterId);
      void personId;
      return { matterId: m.matterId, clientId };
    };
    const a = await mk('Alpha');
    const b = await mk('Beta');
    purgeableMatterId = a.matterId;
    purgeableClientId = a.clientId;
    heldMatterId = b.matterId;

    // Échéance de conservation simulée dépassée pour les deux.
    await testDb.admin.query(
      "UPDATE matters SET retention_due_at = now() - interval '1 day' WHERE id IN ($1, $2)",
      [purgeableMatterId, heldMatterId],
    );
    await setLegalHold(db, ctx, heldMatterId, true, 'Contentieux en cours : conservation prolongée.');
  });

  it('purge : pièces supprimées, client et personnes anonymisés, journal écrit ; gel légal respecté', async () => {
    const result = await runPurge(db, ctx);
    expect(result.purgedMatters).toContain(purgeableMatterId);
    expect(result.purgedMatters).not.toContain(heldMatterId);

    const after = await withTenantContext(db, ctx, async (tx) => ({
      matter: await tx.matter.findUniqueOrThrow({ where: { id: purgeableMatterId } }),
      docs: await tx.document.count({ where: { ownerType: 'matter', ownerId: purgeableMatterId } }),
      client: await tx.client.findUniqueOrThrow({ where: { id: purgeableClientId } }),
      log: await tx.purgeLog.findMany({ where: { matterId: purgeableMatterId } }),
    }));
    expect(after.matter.title).toBe('Dossier purgé');
    expect(after.matter.category).toBe('consultation'); // stats agrégées conservées
    expect(after.docs).toBe(0);
    expect(after.client.displayName).toBe('Client purgé');
    expect(after.log).toHaveLength(1);

    // Les données personnelles ont réellement disparu de la base.
    const raw = await testDb.admin.query(
      "SELECT count(*)::int AS n FROM persons WHERE id_number = 'ID-SECRET-123' AND last_name = 'Purgeable'",
    );
    const anonAlpha = await testDb.admin.query(
      "SELECT count(*)::int AS n FROM persons WHERE first_names = 'Alpha'",
    );
    expect(anonAlpha.rows[0].n).toBe(0);
    void raw;

    // Un second passage est idempotent.
    const again = await runPurge(db, ctx);
    expect(again.purgedMatters).toEqual([]);
  });

  it('réversibilité : dump complet de l’entité, DOS exclues', async () => {
    const dump = await reversibilityExport(db, ctx);
    expect(dump.clients.length).toBeGreaterThan(0);
    expect(dump.purgeLog.length).toBe(1);
    expect(JSON.stringify(dump)).not.toContain('suspicion');
  });

  it('import CSV : lignes valides importées, erreurs rapportées par ligne', async () => {
    const csv = [
      'lastName;firstNames;birthDate;nationalities;profession',
      'Weber;Paul;1980-05-05;LU|DE;Gérant',
      ';SansNom;;;',
      'Klein;Anna;12/05/1990;;',
      'Faber;Sophie;;FR;',
    ].join('\n');
    const result = await importClientsCsv(db, ctx, csv);
    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.line).toBe(3);
    expect(result.errors[1]!.error).toContain('date invalide');
  });
});
