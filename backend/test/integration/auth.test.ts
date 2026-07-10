import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import { createDb, type Db } from '../../src/db.js';
import {
  AuthError,
  activateMfa,
  authenticate,
  login,
  logout,
  register,
  type AuthDeps,
} from '../../src/modules/auth/service.js';
import { verifyAuditChain } from '../../src/audit.js';
import { setupTestDb, TEST_ENC_KEY, type TestDb } from './setup.js';

// M1 — flux complet : inscription → enrôlement MFA obligatoire → connexion →
// session glissante → verrouillage progressif (US-1.1).

let testDb: TestDb;
let db: Db;
let deps: AuthDeps;

const EMAIL = 'maitre.solo@barreau.lu';
const PASSWORD = 'Corr3ct-Cheval-Batterie!';

function extractSecret(otpauthUrl: string): string {
  return new URL(otpauthUrl).searchParams.get('secret')!;
}

beforeAll(async () => {
  testDb = await setupTestDb();
  db = createDb(testDb.appUrl);
  deps = { db, encKeyHex: TEST_ENC_KEY, sessionTtlHours: 8 };
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.close();
});

describe('authentification MFA obligatoire (US-1.1)', () => {
  let otpSecret: string;

  it('inscription : mot de passe faible refusé', async () => {
    await expect(register(deps, { email: EMAIL, password: 'court' })).rejects.toMatchObject({
      code: 'password_policy',
    });
  });

  it('inscription : compte créé en pending_mfa avec URL d’enrôlement TOTP', async () => {
    const result = await register(deps, { email: EMAIL, password: PASSWORD });
    expect(result.otpauthUrl).toContain('otpauth://totp/');
    otpSecret = extractSecret(result.otpauthUrl);
    const user = await db.user.findUnique({ where: { email: EMAIL } });
    expect(user!.status).toBe('pending_mfa');
    // Le secret TOTP n'est jamais stocké en clair.
    expect(user!.mfaSecretEnc).not.toContain(otpSecret);
  });

  it('connexion impossible tant que la MFA n’est pas activée', async () => {
    const code = authenticator.generate(otpSecret);
    await expect(login(deps, { email: EMAIL, password: PASSWORD, code })).rejects.toMatchObject({
      code: 'mfa_required',
    });
  });

  it('activation MFA : code invalide refusé, code valide accepté', async () => {
    await expect(
      activateMfa(deps, { email: EMAIL, password: PASSWORD, code: '000000' }),
    ).rejects.toMatchObject({ code: 'mfa_invalid' });
    await activateMfa(deps, { email: EMAIL, password: PASSWORD, code: authenticator.generate(otpSecret) });
    const user = await db.user.findUnique({ where: { email: EMAIL } });
    expect(user!.status).toBe('active');
  });

  it('connexion : mot de passe + TOTP → session opaque, hachée en base', async () => {
    const result = await login(deps, {
      email: EMAIL,
      password: PASSWORD,
      code: authenticator.generate(otpSecret),
    });
    expect(result.token.length).toBeGreaterThan(30);
    const stored = await db.session.findFirst({ where: { userId: result.userId } });
    expect(stored!.tokenHash).not.toBe(result.token);

    const session = await authenticate(deps, result.token);
    expect(session?.userId).toBe(result.userId);

    await logout(deps, result.token);
    expect(await authenticate(deps, result.token)).toBeNull();
  });

  it('verrouillage progressif après 5 échecs', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        login(deps, { email: EMAIL, password: 'MauvaisMotDePasse123', code: '000000' }),
      ).rejects.toBeInstanceOf(AuthError);
    }
    // 6e tentative, même avec les bons identifiants : compte verrouillé.
    await expect(
      login(deps, { email: EMAIL, password: PASSWORD, code: authenticator.generate(otpSecret) }),
    ).rejects.toMatchObject({ code: 'account_locked' });
    // Déverrouillage simulé (le délai est expiré) → connexion à nouveau possible.
    await db.user.update({
      where: { email: EMAIL },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const result = await login(deps, {
      email: EMAIL,
      password: PASSWORD,
      code: authenticator.generate(otpSecret),
    });
    expect(result.userId).toBeTruthy();
  });
});

describe("journal d'audit (US-10.1)", () => {
  it('la chaîne de hachés est intègre après tous les événements du flux', async () => {
    // Vérification avec la connexion privilégiée : elle voit TOUS les événements.
    const adminDb = createDb(testDb.adminUrl);
    try {
      await adminDb.$transaction(async (tx) => {
        expect(await verifyAuditChain(tx)).toBeNull();
      });
    } finally {
      await adminDb.$disconnect();
    }
  });

  it('le journal est append-only : UPDATE et DELETE rejetés même en admin', async () => {
    const count = await testDb.admin.query('SELECT count(*)::int AS n FROM audit_log');
    expect(count.rows[0].n).toBeGreaterThan(0);
    await expect(testDb.admin.query("UPDATE audit_log SET action = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(testDb.admin.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });
});
