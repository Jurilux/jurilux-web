import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenantContext, type Db } from '../../src/db.js';
import { createOrganization } from '../../src/modules/orgs/service.js';
import { hashPassword } from '../../src/crypto.js';
import { setupTestDb, type TestDb } from './setup.js';

// Critère d'acceptation global n°5 (§ D.9) : deux associés en coûts partagés
// ne peuvent EN AUCUN CAS accéder aux données l'un de l'autre.
// Ici le cloisonnement est vérifié au niveau RLS PostgreSQL, avec la connexion
// applicative non privilégiée — même un bug applicatif (WHERE oublié) ne peut
// pas franchir la frontière d'entité.

let testDb: TestDb;
let db: Db;
let userA: string;
let userB: string;
let entityA: string;
let entityB: string;
let orgId: string;

beforeAll(async () => {
  testDb = await setupTestDb();
  db = createDb(testDb.appUrl);

  // Deux associés en coûts partagés (créés hors RLS : la table users n'est pas tenant-scopée).
  const insertUser = async (email: string) => {
    const row = await db.user.create({
      data: { email, passwordHash: await hashPassword('Corr3ct-Cheval-Batterie!'), status: 'active' },
    });
    return row.id;
  };
  userA = await insertUser('associe.a@etude.lu');
  userB = await insertUser('associe.b@etude.lu');

  // L'associé A crée l'organisation en mode coûts partagés → deux entités étanches.
  const created = await createOrganization(db, userA, {
    name: 'Étude Kayl & Wiltz',
    practiceMode: 'shared_costs',
    partnerEntityNames: ['Me Kayl', 'Me Wiltz'],
  });
  orgId = created.orgId;
  entityA = created.entities[0]!.id;
  entityB = created.entities[1]!.id;

  // Réaffectation : A owner de la seule entité A, B owner de la seule entité B.
  await testDb.admin.query('DELETE FROM memberships WHERE user_id = $1 AND entity_id = $2', [
    userA,
    entityB,
  ]);
  await testDb.admin.query(
    "INSERT INTO memberships (user_id, entity_id, role) VALUES ($1, $2, 'owner')",
    [userB, entityB],
  );
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.close();
});

describe('cloisonnement multi-tenant RLS (coûts partagés, US-2.1)', () => {
  it("l'associé A voit son entité mais jamais celle de B", async () => {
    const visible = await withTenantContext(
      db,
      { userId: userA, entityIds: [entityA], orgIds: [orgId] },
      (tx) => tx.complianceEntity.findMany(),
    );
    expect(visible.map((e) => e.id)).toEqual([entityA]);
  });

  it("même en demandant explicitement l'entité de B par id, A n'obtient rien", async () => {
    const stolen = await withTenantContext(
      db,
      { userId: userA, entityIds: [entityA], orgIds: [orgId] },
      (tx) => tx.complianceEntity.findUnique({ where: { id: entityB } }),
    );
    expect(stolen).toBeNull();
  });

  it('A ne peut pas modifier l’entité de B (0 ligne affectée)', async () => {
    const result = await withTenantContext(
      db,
      { userId: userA, entityIds: [entityA], orgIds: [orgId] },
      (tx) =>
        tx.complianceEntity.updateMany({
          where: { id: entityB },
          data: { name: 'PIRATÉ' },
        }),
    );
    expect(result.count).toBe(0);
    const check = await testDb.admin.query('SELECT name FROM compliance_entities WHERE id = $1', [
      entityB,
    ]);
    expect(check.rows[0].name).toBe('Me Wiltz');
  });

  it('A ne voit pas les rattachements (memberships) de B', async () => {
    const memberships = await withTenantContext(
      db,
      { userId: userA, entityIds: [entityA], orgIds: [orgId] },
      (tx) => tx.membership.findMany(),
    );
    expect(memberships.every((m) => m.entityId === entityA || m.userId === userA)).toBe(true);
    expect(memberships.some((m) => m.userId === userB)).toBe(false);
  });

  it("A ne peut pas s'inviter lui-même dans l'entité de B (INSERT bloqué par RLS)", async () => {
    await expect(
      withTenantContext(db, { userId: userA, entityIds: [entityA], orgIds: [orgId] }, (tx) =>
        tx.membership.create({ data: { userId: userA, entityId: entityB, role: 'owner' } }),
      ),
    ).rejects.toThrow();
  });

  it("le journal d'audit est lui aussi cloisonné par entité", async () => {
    const eventsForA = await withTenantContext(
      db,
      { userId: userA, entityIds: [entityA], orgIds: [orgId] },
      (tx) => tx.auditEvent.findMany(),
    );
    expect(eventsForA.length).toBeGreaterThan(0);
    expect(eventsForA.every((e) => e.entityId === entityA)).toBe(true);
  });

  it('hors de tout contexte tenant, aucune donnée métier ne sort', async () => {
    const rows = await withTenantContext(
      db,
      { userId: userA, entityIds: [], orgIds: [] },
      (tx) => tx.complianceEntity.findMany(),
    );
    expect(rows).toEqual([]);
  });
});
