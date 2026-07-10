import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenantContext, type Db, type TenantContext } from '../../src/db.js';
import { createOrganization } from '../../src/modules/orgs/service.js';
import { createNaturalClient } from '../../src/modules/clients/service.js';
import { activateMatter, createMatter } from '../../src/modules/matters/service.js';
import { assessMatterRisk } from '../../src/modules/risk/service.js';
import { completePeriodicReview, todoBoard } from '../../src/modules/vigilance/service.js';
import {
  batonnierDossier,
  createSuspicionReport,
  decideSuspicionReport,
  listSuspicionReports,
  type DosDeps,
} from '../../src/modules/dos/service.js';
import {
  addPssfMandate,
  addRbeCheck,
  addTraining,
  decisionsRegistry,
  listPssfMandates,
  listTrainings,
} from '../../src/modules/registries/service.js';
import { requireEntityAction } from '../../src/entityAuth.js';
import { hashPassword } from '../../src/crypto.js';
import { setupTestDb, TEST_ENC_KEY, type TestDb } from './setup.js';

// Sprints 5-6 : M6 vigilance continue, M7 DOS cloisonnée (test anti tipping-off,
// critère d'acceptation global n°4), M8 registres.

let testDb: TestDb;
let db: Db;
let dos: DosDeps;
let ownerCtx: TenantContext; // owner : dos.read / dos.decide
let assistantCtx: TenantContext; // assistant : dos.create uniquement
let entityId: string;
let assistantId: string;

const inScopeAnswers = {
  category: 'real_estate' as const,
  isDefenseOrJudicialProceedings: false,
  isPureLegalConsultation: false,
  assistsInTransaction: true,
  handlesClientFunds: false,
};

async function makeMatter(title: string) {
  const { clientId } = await createNaturalClient(db, ownerCtx, {
    firstNames: 'Test',
    lastName: title,
  });
  return createMatter(db, ownerCtx, {
    clientId,
    title,
    category: 'real_estate',
    answers: inScopeAnswers,
    fundsOrigin: 'épargne',
    countries: ['LU'],
    estVolume: '100k',
  });
}

beforeAll(async () => {
  testDb = await setupTestDb();
  db = createDb(testDb.appUrl);
  dos = { db, encKeyHex: TEST_ENC_KEY };

  const mkUser = async (email: string) =>
    (
      await db.user.create({
        data: { email, passwordHash: await hashPassword('Corr3ct-Cheval-Batterie!'), status: 'active' },
      })
    ).id;
  const ownerId = await mkUser('owner@etude.lu');
  assistantId = await mkUser('assistant@etude.lu');

  const org = await createOrganization(db, ownerId, {
    name: 'Étude Vigilance',
    practiceMode: 'individual',
  });
  entityId = org.entities[0]!.id;
  await testDb.admin.query(
    "INSERT INTO memberships (user_id, entity_id, role) VALUES ($1, $2, 'assistant')",
    [assistantId, entityId],
  );
  ownerCtx = { userId: ownerId, entityIds: [entityId], orgIds: [org.orgId] };
  assistantCtx = { userId: assistantId, entityIds: [entityId], orgIds: [org.orgId] };
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.close();
});

describe('M6 — vigilance continue', () => {
  it("l'activation pose l'échéance de revue selon le risque (faible → 3 ans)", async () => {
    const m = await makeMatter('Revue3ans');
    await assessMatterRisk(db, ownerCtx, m.matterId);
    const activated = await activateMatter(db, ownerCtx, m.matterId, { canApproveHighRisk: true });
    const years = activated.nextReviewAt!.getFullYear() - new Date().getFullYear();
    expect(years).toBe(3);
  });

  it('revue guidée : re-score consigné + nouvelle échéance ; dossier remonte au « À faire » quand elle est due', async () => {
    const m = await makeMatter('RevueDue');
    await assessMatterRisk(db, ownerCtx, m.matterId);
    await activateMatter(db, ownerCtx, m.matterId, { canApproveHighRisk: true });
    // Échéance simulée dépassée.
    await withTenantContext(db, ownerCtx, (tx) =>
      tx.matter.update({ where: { id: m.matterId }, data: { nextReviewAt: new Date(Date.now() - 1000) } }),
    );
    const board = await todoBoard(db, ownerCtx);
    expect(board.reviewsDue.some((r) => r.matterId === m.matterId)).toBe(true);

    const review = await completePeriodicReview(
      db,
      ownerCtx,
      m.matterId,
      { identityStillValid: true, beneficialOwnersUnchanged: true, activityConsistent: true },
      'RAS',
    );
    expect(review.riskLevel).toBe('low');
    expect(review.nextReviewAt.getFullYear() - new Date().getFullYear()).toBe(3);

    const after = await todoBoard(db, ownerCtx);
    expect(after.reviewsDue.some((r) => r.matterId === m.matterId)).toBe(false);
  });
});

describe('M7 — DOS cloisonnée (anti tipping-off, CA n°4)', () => {
  let matterId: string;

  it('un assistant crée un signalement : accusé neutre, sans identifiant', async () => {
    const m = await makeMatter('DossierSensible');
    matterId = m.matterId;
    const ack = await createSuspicionReport(
      dos,
      assistantCtx,
      matterId,
      'Fonds en espèces d’origine inexpliquée, pression pour aller vite.',
    );
    expect(ack).toEqual({ acknowledged: true });
  });

  it("ANTI TIPPING-OFF : l'assistant ne peut ni lister ni décider (permission refusée)", async () => {
    await expect(
      requireEntityAction(db, assistantId, entityId, 'dos.read'),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      requireEntityAction(db, assistantId, entityId, 'dos.decide'),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('ANTI TIPPING-OFF : aucune trace du signalement sur le dossier vu par les non-habilités', async () => {
    const matter = await withTenantContext(db, assistantCtx, (tx) =>
      tx.matter.findUniqueOrThrow({ where: { id: matterId } }),
    );
    const serialized = JSON.stringify(matter).toLowerCase();
    for (const marker of ['suspicion', 'signalement', 'tipping', 'goaml', 'batonnier']) {
      expect(serialized, `le dossier ne doit pas exposer « ${marker} »`).not.toContain(marker);
    }
    // ... et aucun champ du modèle Matter ne référence la DOS.
    expect(Object.keys(matter).some((k) => /suspicion|dos/i.test(k))).toBe(false);
  });

  it('le RC (owner) voit le signalement déchiffré ; le contenu est chiffré en base', async () => {
    const reports = await listSuspicionReports(dos, ownerCtx);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.description).toContain('espèces');

    const raw = await testDb.admin.query('SELECT encrypted_payload FROM suspicion_reports');
    expect(raw.rows[0].encrypted_payload).not.toContain('espèces');
  });

  it('décision no_declaration motivée → conservée au registre ; dossier Bâtonnier généré', async () => {
    const reports = await listSuspicionReports(dos, ownerCtx);
    const id = reports[0]!.id;
    await expect(decideSuspicionReport(dos, ownerCtx, id, 'no_declaration', ' ')).rejects.toMatchObject(
      { code: 'reason_required' },
    );
    const decided = await decideSuspicionReport(
      dos,
      ownerCtx,
      id,
      'no_declaration',
      'Justificatifs bancaires produits : origine des fonds établie.',
    );
    expect(decided.status).toBe('no_declaration');

    const dossier = await batonnierDossier(dos, ownerCtx, id);
    expect(dossier.markdown).toContain('immunité');
    expect(dossier.markdown).toContain('art. 5(4)');
  });
});

describe('M8 — registres', () => {
  it('formations : enregistrement + total annuel par personne', async () => {
    await addTraining(db, ownerCtx, {
      personLabel: 'Me Owner',
      trainingDate: '2026-03-10',
      title: 'Formation LBC/FT Barreau',
      hours: 3,
    });
    await addTraining(db, ownerCtx, {
      personLabel: 'Me Owner',
      trainingDate: '2026-06-02',
      title: 'Actualité mesures restrictives',
      hours: 2.5,
    });
    const registry = await listTrainings(db, ownerCtx, 2026);
    expect(registry.records).toHaveLength(2);
    expect(registry.annualTotals).toEqual([{ personLabel: 'Me Owner', hours: 5.5 }]);
  });

  it('mandats PSSF : actif tant que non clôturé', async () => {
    const { id } = await addPssfMandate(db, ownerCtx, {
      companyName: 'HoldCo SA',
      function: 'Administrateur',
      startDate: '2025-01-15',
    });
    let mandates = await listPssfMandates(db, ownerCtx);
    expect(mandates.find((m) => m.id === id)?.active).toBe(true);
    const { endPssfMandate } = await import('../../src/modules/registries/service.js');
    await endPssfMandate(db, ownerCtx, id, '2026-01-31');
    mandates = await listPssfMandates(db, ownerCtx);
    expect(mandates.find((m) => m.id === id)?.active).toBe(false);
  });

  it('RBE : consultation et divergence consignées', async () => {
    const { clientId } = await createNaturalClient(db, ownerCtx, {
      firstNames: 'Rbe',
      lastName: 'Client',
    });
    await addRbeCheck(db, ownerCtx, {
      clientId,
      checkedAt: '2026-07-01',
      divergence: true,
      divergenceDetails: 'BE déclaré absent de l’extrait RBE.',
      decision: 'Signalement de divergence effectué.',
      reported: true,
      reportedAt: '2026-07-02',
    });
    const checks = await withTenantContext(db, ownerCtx, (tx) => tx.rbeCheck.findMany());
    expect(checks.some((c) => c.divergence && c.reported)).toBe(true);
  });

  it('registre des décisions : DOS en comptage seulement pour les habilités', async () => {
    const forOwner = await decisionsRegistry(db, ownerCtx, true);
    expect(forOwner.dosDecisionsCount).toBe(1);
    const forAssistant = await decisionsRegistry(db, assistantCtx, false);
    expect(forAssistant.dosDecisionsCount).toBeNull();
    expect(JSON.stringify(forAssistant)).not.toContain('espèces');
  });
});
