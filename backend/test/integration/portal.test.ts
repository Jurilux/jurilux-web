import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withTenantContext, type Db, type TenantContext } from '../../src/db.js';
import { createOrganization } from '../../src/modules/orgs/service.js';
import { createNaturalClient } from '../../src/modules/clients/service.js';
import {
  createPortalLink,
  decideSubmission,
  listSubmissions,
  portalConfirmBe,
  portalUpload,
  portalView,
} from '../../src/modules/portal/service.js';
import { hashPassword } from '../../src/crypto.js';
import { setupTestDb, type TestDb } from './setup.js';
import type { StorageAdapter } from '../../src/storage.js';

// M11 — portail client : lien magique, dépôt sans compte, consentement RGPD,
// propositions validées par l'avocat, rejet = suppression de la pièce.

let testDb: TestDb;
let db: Db;
let ctx: TenantContext;
let entityId: string;
let clientId: string;
let token: string;

class MemoryStorage implements StorageAdapter {
  store = new Map<string, Buffer>();
  async put(k: string, d: Buffer) {
    this.store.set(k, d);
  }
  async get(k: string) {
    return this.store.get(k)!;
  }
}
const storage = new MemoryStorage();

beforeAll(async () => {
  testDb = await setupTestDb();
  db = createDb(testDb.appUrl);
  const user = await db.user.create({
    data: { email: 'avocat@portal.lu', passwordHash: await hashPassword('Corr3ct-Cheval-Batterie!'), status: 'active' },
  });
  const org = await createOrganization(db, user.id, { name: 'Étude Portail', practiceMode: 'individual' });
  entityId = org.entities[0]!.id;
  ctx = { userId: user.id, entityIds: [entityId], orgIds: [org.orgId] };
  const created = await createNaturalClient(db, ctx, { firstNames: 'Client', lastName: 'Final' });
  clientId = created.clientId;
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.close();
});

describe('portail client (M11)', () => {
  it('lien magique : créé par l’avocat, jeton haché en base, TTL 7 jours', async () => {
    const link = await createPortalLink(db, ctx, clientId);
    token = new URLSearchParams(link.path.split('?')[1]).get('t')!;
    expect(token.length).toBeGreaterThan(30);
    const stored = await withTenantContext(db, ctx, (tx) => tx.portalLink.findFirst());
    expect(stored!.tokenHash).not.toBe(token);
    const days = Math.round((link.expiresAt.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(7);
  });

  it('vue publique : nom de l’étude et du client, sans plus', async () => {
    const view = await portalView(db, entityId, token);
    expect(view.firmName).toBe('Étude Portail');
    expect(view.clientDisplayName).toBe('FINAL Client');
    expect(Object.keys(view).sort()).toEqual(['accepts', 'clientDisplayName', 'expiresAt', 'firmName']);
  });

  it('jeton invalide ou expiré → refusé', async () => {
    await expect(portalView(db, entityId, 'jeton-bidon-vraiment-faux')).rejects.toMatchObject({
      code: 'forbidden',
    });
    await testDb.admin.query("UPDATE portal_links SET expires_at = now() - interval '1 hour'");
    await expect(portalView(db, entityId, token)).rejects.toMatchObject({ code: 'forbidden' });
    await testDb.admin.query("UPDATE portal_links SET expires_at = now() + interval '7 days'");
  });

  it('dépôt sans consentement RGPD → refusé ; avec consentement → proposition pending', async () => {
    await expect(
      portalUpload(db, storage, entityId, token, {
        docType: 'id_card',
        fileName: 'cni.pdf',
        data: Buffer.from('%PDF-1.7 cni client final'),
        consent: false,
      }),
    ).rejects.toMatchObject({ code: 'consent_required' });

    const ok = await portalUpload(db, storage, entityId, token, {
      docType: 'id_card',
      fileName: 'cni.pdf',
      data: Buffer.from('%PDF-1.7 cni client final'),
      consent: true,
    });
    expect(ok.received).toBe(true);

    await portalConfirmBe(db, entityId, token, { confirmed: true, consent: true });

    const submissions = await listSubmissions(db, ctx);
    expect(submissions).toHaveLength(2);
    expect(submissions.every((s) => s.status === 'pending')).toBe(true);
    expect(submissions[0]!.clientDisplayName).toBe('FINAL Client');
  });

  it('validation avocat : accepté conservé ; rejeté → pièce supprimée (minimisation)', async () => {
    const submissions = await listSubmissions(db, ctx);
    const docSubmission = submissions.find((s) => s.kind === 'document')!;
    const beSubmission = submissions.find((s) => s.kind === 'be_confirmation')!;

    await decideSubmission(db, ctx, beSubmission.id, 'accepted');
    await decideSubmission(db, ctx, docSubmission.id, 'rejected');

    const remainingDoc = await withTenantContext(db, ctx, (tx) =>
      tx.document.count({ where: { id: docSubmission.documentId! } }),
    );
    expect(remainingDoc).toBe(0);
    expect(await listSubmissions(db, ctx)).toHaveLength(0);
    await expect(decideSubmission(db, ctx, beSubmission.id, 'rejected')).rejects.toMatchObject({
      code: 'already_decided',
    });
  });
});
