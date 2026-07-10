import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenantContext, type Db, type TenantContext } from '../../src/db.js';
import { createOrganization } from '../../src/modules/orgs/service.js';
import {
  addClientLink,
  createLegalClient,
  createNaturalClient,
  listClients,
  personCompleteness,
} from '../../src/modules/clients/service.js';
import {
  activateMatter,
  closeMatter,
  createMatter,
  requalifyMatter,
} from '../../src/modules/matters/service.js';
import { uploadDocument, expiringDocuments, sniffMime } from '../../src/modules/documents/service.js';
import { hashPassword } from '../../src/crypto.js';
import { setupTestDb, type TestDb } from './setup.js';
import type { StorageAdapter } from '../../src/storage.js';

// Sprints 1-2 : M3 clients & BE, documents, M4 dossiers — règles d'activation
// (US-3.3, US-4.2), conservation (US-4.4), re-qualification tracée (US-4.1),
// cloisonnement RLS sur les nouvelles tables.

let testDb: TestDb;
let db: Db;
let ctxA: TenantContext;
let ctxB: TenantContext;

class MemoryStorage implements StorageAdapter {
  store = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.store.set(key, data);
  }
  async get(key: string) {
    return this.store.get(key)!;
  }
}
const storage = new MemoryStorage();

const PDF = Buffer.from('%PDF-1.7\n%fake\n');

beforeAll(async () => {
  testDb = await setupTestDb();
  db = createDb(testDb.appUrl);

  const mkUser = async (email: string) => {
    const u = await db.user.create({
      data: { email, passwordHash: await hashPassword('Corr3ct-Cheval-Batterie!'), status: 'active' },
    });
    return u.id;
  };
  const userA = await mkUser('a@etude.lu');
  const userB = await mkUser('b@etude.lu');

  const created = await createOrganization(db, userA, {
    name: 'Étude CM',
    practiceMode: 'shared_costs',
    partnerEntityNames: ['Me A', 'Me B'],
  });
  const [entityA, entityB] = created.entities;
  await testDb.admin.query('DELETE FROM memberships WHERE user_id = $1 AND entity_id = $2', [
    userA,
    entityB!.id,
  ]);
  await testDb.admin.query(
    "INSERT INTO memberships (user_id, entity_id, role) VALUES ($1, $2, 'owner')",
    [userB, entityB!.id],
  );
  ctxA = { userId: userA, entityIds: [entityA!.id], orgIds: [] };
  ctxB = { userId: userB, entityIds: [entityB!.id], orgIds: [] };
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.close();
});

describe('M3 — clients & bénéficiaires effectifs', () => {
  it('client PP : création minimale + indicateur de complétude', async () => {
    const { clientId, personId } = await createNaturalClient(db, ctxA, {
      firstNames: 'Jean',
      lastName: 'Muller',
    });
    expect(clientId).toBeTruthy();
    const person = await withTenantContext(db, ctxA, (tx) =>
      tx.person.findUniqueOrThrow({ where: { id: personId } }),
    );
    expect(personCompleteness(person)).toBe(0);
    const clients = await listClients(db, ctxA);
    expect(clients[0]!.displayName).toBe('MULLER Jean');
    expect(clients[0]!.links.map((l) => l.role)).toContain('self');
  });

  it('dirigeant principal sans justification : refusé (US-3.3)', async () => {
    const { clientId } = await createLegalClient(db, ctxA, { name: 'Sans BE SA', country: 'LU' });
    await expect(
      addClientLink(db, ctxA, clientId, {
        role: 'principal_director',
        person: { firstNames: 'Paul', lastName: 'Weber' },
      }),
    ).rejects.toMatchObject({ code: 'justification_required' });
  });

  it('BE ≤ 25 % sans nature de contrôle : refusé', async () => {
    const { clientId } = await createLegalClient(db, ctxA, { name: 'Holding X', country: 'LU' });
    await expect(
      addClientLink(db, ctxA, clientId, {
        role: 'beneficial_owner',
        person: { firstNames: 'Anna', lastName: 'Klein' },
        ownershipPct: 10,
      }),
    ).rejects.toMatchObject({ code: 'control_nature_required' });
  });

  it('cloisonnement : les clients de A sont invisibles pour B', async () => {
    const fromB = await listClients(db, ctxB);
    expect(fromB).toEqual([]);
  });
});

describe('M4 — dossiers : qualification, activation, clôture', () => {
  it('dossier in scope démarre en pending_cdd ; hors champ en draft', async () => {
    const { clientId } = await createNaturalClient(db, ctxA, {
      firstNames: 'Marie',
      lastName: 'Schmit',
    });
    const inScope = await createMatter(db, ctxA, {
      clientId,
      title: 'Achat immeuble Kirchberg',
      category: 'real_estate',
      answers: {
        category: 'real_estate',
        isDefenseOrJudicialProceedings: false,
        isPureLegalConsultation: false,
        assistsInTransaction: true,
        handlesClientFunds: false,
      },
    });
    expect(inScope.verdict).toBe('in_scope');
    expect(inScope.status).toBe('pending_cdd');

    const outScope = await createMatter(db, ctxA, {
      clientId,
      title: 'Litige bail commercial',
      category: 'litigation',
      answers: {
        category: 'litigation',
        isDefenseOrJudicialProceedings: true,
        isPureLegalConsultation: false,
        assistsInTransaction: false,
        handlesClientFunds: false,
      },
    });
    expect(outScope.verdict).toBe('exempt_defense');
    expect(outScope.status).toBe('draft');
  });

  it('activation in scope bloquée sans champs obligatoires (US-4.2)', async () => {
    const { clientId } = await createNaturalClient(db, ctxA, {
      firstNames: 'Luc',
      lastName: 'Hoffmann',
    });
    const m = await createMatter(db, ctxA, {
      clientId,
      title: 'Vente terrain',
      category: 'real_estate',
      answers: {
        category: 'real_estate',
        isDefenseOrJudicialProceedings: false,
        isPureLegalConsultation: false,
        assistsInTransaction: true,
        handlesClientFunds: false,
      },
    });
    await expect(activateMatter(db, ctxA, m.matterId)).rejects.toMatchObject({
      code: 'missing_required_fields',
    });
  });

  it('activation in scope PM bloquée sans BE vérifié, puis possible (US-3.3 CA)', async () => {
    const { clientId } = await createLegalClient(db, ctxA, { name: 'PropCo SARL', country: 'LU' });
    const m = await createMatter(db, ctxA, {
      clientId,
      title: 'Constitution filiale',
      category: 'company_formation',
      answers: {
        category: 'company_formation',
        isDefenseOrJudicialProceedings: false,
        isPureLegalConsultation: false,
        assistsInTransaction: true,
        handlesClientFunds: false,
      },
      fundsOrigin: 'fonds propres',
      countries: ['LU'],
      estVolume: '100k-500k',
    });
    await expect(activateMatter(db, ctxA, m.matterId)).rejects.toMatchObject({
      code: 'beneficial_owner_required',
    });

    await addClientLink(db, ctxA, clientId, {
      role: 'beneficial_owner',
      person: { firstNames: 'Sophie', lastName: 'Faber' },
      ownershipPct: 60,
      verified: true,
    });
    const activated = await activateMatter(db, ctxA, m.matterId);
    expect(activated.status).toBe('active');
  });

  it('re-qualification : motif obligatoire, révision tracée', async () => {
    const { clientId } = await createNaturalClient(db, ctxA, {
      firstNames: 'Nina',
      lastName: 'Thill',
    });
    const m = await createMatter(db, ctxA, {
      clientId,
      title: 'Consultation fiscale',
      category: 'tax_advice',
      answers: {
        category: 'tax_advice',
        isDefenseOrJudicialProceedings: false,
        isPureLegalConsultation: true,
        assistsInTransaction: false,
        handlesClientFunds: false,
      },
    });
    expect(m.verdict).toBe('exempt_consultation');

    const requalified = await requalifyMatter(
      db,
      ctxA,
      m.matterId,
      {
        category: 'tax_advice',
        isDefenseOrJudicialProceedings: false,
        isPureLegalConsultation: false,
        assistsInTransaction: true,
        handlesClientFunds: false,
      },
      'Le mandat évolue vers la structuration de la transaction.',
    );
    expect(requalified.verdict).toBe('in_scope');

    const revisions = await withTenantContext(db, ctxA, (tx) =>
      tx.scopingRevision.findMany({ where: { matterId: m.matterId }, orderBy: { createdAt: 'asc' } }),
    );
    expect(revisions).toHaveLength(2);
    expect(revisions[1]!.reason).toContain('structuration');
  });

  it('clôture : retention_due_at = clôture + 5 ans (paramétré, US-4.4)', async () => {
    const { clientId } = await createNaturalClient(db, ctxA, {
      firstNames: 'Tom',
      lastName: 'Wagner',
    });
    const m = await createMatter(db, ctxA, {
      clientId,
      title: 'Dossier à clore',
      category: 'consultation',
      answers: {
        category: 'consultation',
        isDefenseOrJudicialProceedings: false,
        isPureLegalConsultation: true,
        assistsInTransaction: false,
        handlesClientFunds: false,
      },
    });
    const closed = await closeMatter(db, ctxA, m.matterId);
    const years =
      closed.retentionDueAt.getFullYear() - new Date().getFullYear();
    expect(years).toBe(5);
    await expect(closeMatter(db, ctxA, m.matterId)).rejects.toMatchObject({ code: 'matter_closed' });
  });

  it('cloisonnement : B ne peut pas agir sur un dossier de A', async () => {
    const { clientId } = await createNaturalClient(db, ctxA, {
      firstNames: 'Eva',
      lastName: 'Reuter',
    });
    const m = await createMatter(db, ctxA, {
      clientId,
      title: 'Dossier privé A',
      category: 'consultation',
      answers: {
        category: 'consultation',
        isDefenseOrJudicialProceedings: false,
        isPureLegalConsultation: true,
        assistsInTransaction: false,
        handlesClientFunds: false,
      },
    });
    await expect(closeMatter(db, ctxB, m.matterId)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('M3 — documents', () => {
  it('sniffMime : contenu réel vérifié, pas l’extension', () => {
    expect(sniffMime(PDF)).toBe('application/pdf');
    expect(sniffMime(Buffer.from('MZ9024 pas un pdf....'))).toBeNull();
  });

  it('upload + expiration : un document expirant sous 60 jours remonte', async () => {
    const { clientId, personId } = await createNaturalClient(db, ctxA, {
      firstNames: 'Ben',
      lastName: 'Kremer',
    });
    void clientId;
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const uploaded = await uploadDocument(db, storage, ctxA, {
      ownerType: 'person',
      ownerId: personId,
      docType: 'id_card',
      fileName: 'cni.pdf',
      data: PDF,
      expiresAt: soon.toISOString().slice(0, 10),
    });
    expect(uploaded.mimeType).toBe('application/pdf');

    const expiring = await expiringDocuments(db, ctxA);
    expect(expiring.some((d) => d.id === uploaded.documentId)).toBe(true);
    // ... et invisible pour B (RLS).
    const forB = await expiringDocuments(db, ctxB);
    expect(forB).toEqual([]);
  });

  it('fichier non supporté : refusé sur le contenu', async () => {
    await expect(
      uploadDocument(db, storage, ctxA, {
        ownerType: 'entity',
        ownerId: ctxA.entityIds[0]!,
        docType: 'procedure',
        fileName: 'script.exe',
        data: Buffer.from('MZ\x90\x00\x03exe-header'),
      }),
    ).rejects.toMatchObject({ code: 'unsupported_file_type' });
  });
});
