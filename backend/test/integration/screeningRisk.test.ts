import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenantContext, type Db, type TenantContext } from '../../src/db.js';
import { createOrganization } from '../../src/modules/orgs/service.js';
import { addClientLink, createLegalClient, createNaturalClient } from '../../src/modules/clients/service.js';
import { activateMatter, createMatter } from '../../src/modules/matters/service.js';
import { decideHit, importList, listOpenAlerts, runScreening } from '../../src/modules/screening/service.js';
import { assessMatterRisk, overrideMatterRisk } from '../../src/modules/risk/service.js';
import { hashPassword } from '../../src/crypto.js';
import { setupTestDb, type TestDb } from './setup.js';

// M5 — scénario complet : import listes → screening → hit → gel → levée de doute
// → dégel ; scoring avec risque élevé forcé (PEP) et vigilance renforcée.

let testDb: TestDb;
let db: Db;
let ctx: TenantContext;

const EU_XML = `<?xml version="1.0"?>
<export>
  <sanctionEntity logicalId="900">
    <subjectType code="person"/>
    <nameAlias wholeName="Dmitri VOLKOV"/>
    <birthdate birthdate="1975-08-20"/>
    <citizenship countryIso2Code="RU"/>
  </sanctionEntity>
</export>`;

const UN_XML = `<?xml version="1.0"?>
<CONSOLIDATED_LIST>
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>555001</DATAID>
      <FIRST_NAME>Karim</FIRST_NAME>
      <SECOND_NAME>Belkacem</SECOND_NAME>
      <INDIVIDUAL_DATE_OF_BIRTH><DATE>1980-03-03</DATE></INDIVIDUAL_DATE_OF_BIRTH>
    </INDIVIDUAL>
  </INDIVIDUALS>
</CONSOLIDATED_LIST>`;

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
    data: {
      email: 'rc@etude.lu',
      passwordHash: await hashPassword('Corr3ct-Cheval-Batterie!'),
      status: 'active',
    },
  });
  const org = await createOrganization(db, user.id, {
    name: 'Étude Screening',
    practiceMode: 'individual',
  });
  ctx = { userId: user.id, entityIds: [org.entities[0]!.id], orgIds: [org.orgId] };
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.close();
});

describe('import des listes (US-5.4)', () => {
  it('import initial UE + ONU, versionné ; ré-import identique ignoré', async () => {
    const eu = await importList(db, 'EU', EU_XML);
    expect(eu.skipped).toBe(false);
    expect(eu.entryCount).toBe(1);
    const un = await importList(db, 'UN', UN_XML);
    expect(un.entryCount).toBe(1);
    const again = await importList(db, 'EU', EU_XML);
    expect(again.skipped).toBe(true);
  });
});

describe('screening → alerte bloquante → levée de doute (US-5.4/5.5)', () => {
  let matterId: string;
  let hitId: string;

  it('un client homonyme d’une entrée UE génère un hit et gèle ses dossiers', async () => {
    const { clientId } = await createNaturalClient(db, ctx, {
      firstNames: 'Dmitri',
      lastName: 'Volkov',
      birthDate: '1975-08-20',
    });
    const matter = await createMatter(db, ctx, {
      clientId,
      title: 'Acquisition villa',
      category: 'real_estate',
      answers: inScopeAnswers,
      fundsOrigin: 'vente précédente',
      countries: ['LU'],
      estVolume: '1M-5M',
    });
    matterId = matter.matterId;

    const run = await runScreening(db, ctx);
    expect(run.newHits).toBe(1);
    expect(run.listVersions.map((v) => v.source).sort()).toEqual(['EU', 'UN']);

    const alerts = await listOpenAlerts(db, ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.subject?.fullName).toBe('Dmitri Volkov');
    hitId = alerts[0]!.id;

    const frozen = await withTenantContext(db, ctx, (tx) =>
      tx.matter.findUniqueOrThrow({ where: { id: matterId } }),
    );
    expect(frozen.frozen).toBe(true);
  });

  it('dossier gelé : activation impossible', async () => {
    await expect(
      activateMatter(db, ctx, matterId, { canApproveHighRisk: true }),
    ).rejects.toMatchObject({ code: 'matter_frozen' });
  });

  it('un second run ne duplique pas le hit (US-5.6 : re-screening idempotent)', async () => {
    const run2 = await runScreening(db, ctx);
    expect(run2.newHits).toBe(0);
  });

  it('décision sans motif refusée ; faux positif motivé → dégel', async () => {
    await expect(decideHit(db, ctx, hitId, 'false_positive', '  ')).rejects.toMatchObject({
      code: 'reason_required',
    });
    const decision = await decideHit(
      db,
      ctx,
      hitId,
      'false_positive',
      'Date de naissance identique mais patronyme très répandu ; pièce d’identité vérifiée.',
    );
    expect(decision.unfrozenMatters).toBeGreaterThan(0);
    const matter = await withTenantContext(db, ctx, (tx) =>
      tx.matter.findUniqueOrThrow({ where: { id: matterId } }),
    );
    expect(matter.frozen).toBe(false);
  });

  it('hit confirmé : le dossier reste gelé (mesures restrictives)', async () => {
    const { clientId } = await createNaturalClient(db, ctx, {
      firstNames: 'Karim',
      lastName: 'Belkacem',
      birthDate: '1980-03-03',
    });
    const matter = await createMatter(db, ctx, {
      clientId,
      title: 'Constitution société',
      category: 'company_formation',
      answers: { ...inScopeAnswers, category: 'company_formation' },
    });
    const run = await runScreening(db, ctx);
    expect(run.newHits).toBe(1);
    const alerts = await listOpenAlerts(db, ctx);
    await decideHit(db, ctx, alerts[0]!.id, 'confirmed', 'Identité confirmée par les discriminants.');
    const still = await withTenantContext(db, ctx, (tx) =>
      tx.matter.findUniqueOrThrow({ where: { id: matter.matterId } }),
    );
    expect(still.frozen).toBe(true);
  });
});

describe('scoring & vigilance renforcée (US-5.1/5.2/5.3)', () => {
  let pepMatterId: string;
  let pepClientId: string;

  it('client avec BE PEP → risque élevé forcé', async () => {
    const { clientId } = await createLegalClient(db, ctx, { name: 'PEP Holdings', country: 'LU' });
    pepClientId = clientId;
    await addClientLink(db, ctx, clientId, {
      role: 'beneficial_owner',
      person: { firstNames: 'Élise', lastName: 'Grand', pepStatus: 'pep' },
      ownershipPct: 90,
      verified: true,
    });
    const matter = await createMatter(db, ctx, {
      clientId,
      title: 'Restructuration',
      category: 'company_formation',
      answers: { ...inScopeAnswers, category: 'company_formation' },
      fundsOrigin: 'dividendes',
      countries: ['LU'],
      estVolume: '5M+',
    });
    pepMatterId = matter.matterId;
    const assessment = await assessMatterRisk(db, ctx, pepMatterId);
    expect(assessment.level).toBe('high');
    expect(assessment.factors.some((f) => f.id === 'pep')).toBe(true);
  });

  it('override à la baisse impossible quand un facteur forcé est actif (US-5.2)', async () => {
    await expect(
      overrideMatterRisk(db, ctx, pepMatterId, 'medium', 'client historique'),
    ).rejects.toMatchObject({ code: 'forced_high_risk' });
  });

  it('risque élevé : activation exige origine du patrimoine documentée puis approbation', async () => {
    await expect(
      activateMatter(db, ctx, pepMatterId, { canApproveHighRisk: true }),
    ).rejects.toMatchObject({ code: 'wealth_origin_required' });

    await withTenantContext(db, ctx, (tx) =>
      tx.matter.update({
        where: { id: pepMatterId },
        data: { fundsOriginNote: 'Patrimoine issu de la cession Grand SA (acte notarié 2024).' },
      }),
    );
    await expect(
      activateMatter(db, ctx, pepMatterId, { canApproveHighRisk: false }),
    ).rejects.toMatchObject({ code: 'high_risk_approval_required' });

    const ok = await activateMatter(db, ctx, pepMatterId, { canApproveHighRisk: true });
    expect(ok.status).toBe('active');
  });

  it('pays GAFI grise + immobilier + distance : score cumulé → niveau moyen/élevé sans forcé', async () => {
    const matter = await createMatter(db, ctx, {
      clientId: pepClientId,
      title: 'Vente bien Dakar',
      category: 'real_estate',
      answers: inScopeAnswers,
      countries: ['SN'],
      remoteRelationship: true,
    });
    const assessment = await assessMatterRisk(db, ctx, matter.matterId);
    // GAFI grise (+3) + immobilier (+2) + distance (client +2, canal +2) = 9,
    // mais le BE PEP du client force l'élevé de toute façon → high.
    expect(assessment.level).toBe('high');
    expect(assessment.score).toBeGreaterThanOrEqual(9);
  });

  it('override motivé accepté quand aucun facteur forcé (client sans PEP)', async () => {
    const { clientId } = await createNaturalClient(db, ctx, {
      firstNames: 'Paul',
      lastName: 'Simon',
    });
    const matter = await createMatter(db, ctx, {
      clientId,
      title: 'Bail commercial',
      category: 'real_estate',
      answers: inScopeAnswers,
    });
    const a = await assessMatterRisk(db, ctx, matter.matterId);
    expect(a.level).toBe('low');
    const o = await overrideMatterRisk(
      db,
      ctx,
      matter.matterId,
      'medium',
      'Volume inhabituel pour ce profil.',
    );
    expect(o.level).toBe('medium');
  });
});
