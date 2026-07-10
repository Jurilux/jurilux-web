import { authenticator } from 'otplib';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  newOpaqueToken,
  sha256Hex,
  verifyPassword,
} from '../../crypto.js';
import type { Db } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { checkPassword } from './passwordPolicy.js';

// M1 — Identités & accès (US-1.1) :
//  - MFA TOTP obligatoire : un compte reste `pending_mfa` (aucune connexion possible)
//    tant que l'enrôlement n'est pas confirmé par un code valide.
//  - Verrouillage progressif après 5 échecs : 2^(n-5) minutes.
//  - Sessions opaques (SHA-256 en base), glissantes, TTL 8 h, révocables.

export class AuthError extends Error {
  constructor(
    public code:
      | 'invalid_credentials'
      | 'account_locked'
      | 'mfa_required'
      | 'mfa_invalid'
      | 'password_policy'
      | 'email_taken'
      | 'not_pending',
    public detail?: string,
  ) {
    super(code);
  }
}

export interface AuthDeps {
  db: Db;
  encKeyHex: string;
  sessionTtlHours: number;
}

const MAX_FAILURES_BEFORE_LOCK = 5;

function lockDurationMs(failureCount: number): number {
  const exponent = failureCount - MAX_FAILURES_BEFORE_LOCK;
  return 2 ** exponent * 60_000;
}

export async function register(
  deps: AuthDeps,
  input: { email: string; password: string },
): Promise<{ userId: string; otpauthUrl: string }> {
  const policy = checkPassword(input.password, input.email);
  if (!policy.ok) throw new AuthError('password_policy', policy.reason);

  const existing = await deps.db.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AuthError('email_taken');

  const secret = authenticator.generateSecret();
  const user = await deps.db.user.create({
    data: {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      mfaSecretEnc: encryptSecret(secret, deps.encKeyHex),
      status: 'pending_mfa',
    },
  });
  await deps.db.$transaction(async (tx) => {
    await appendAudit(tx, { actorId: user.id, action: 'auth.register' });
  });
  return {
    userId: user.id,
    otpauthUrl: authenticator.keyuri(input.email, 'LexKYC', secret),
  };
}

/** Confirme l'enrôlement MFA : ré-authentifie par mot de passe + premier code TOTP valide. */
export async function activateMfa(
  deps: AuthDeps,
  input: { email: string; password: string; code: string },
): Promise<void> {
  const user = await deps.db.user.findUnique({ where: { email: input.email } });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AuthError('invalid_credentials');
  }
  if (user.status !== 'pending_mfa') throw new AuthError('not_pending');
  const secret = decryptSecret(user.mfaSecretEnc!, deps.encKeyHex);
  if (!authenticator.verify({ token: input.code, secret })) {
    throw new AuthError('mfa_invalid');
  }
  await deps.db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status: 'active' } });
    await appendAudit(tx, { actorId: user.id, action: 'auth.mfa_activated' });
  });
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  userId: string;
}

export async function login(
  deps: AuthDeps,
  input: { email: string; password: string; code: string; ip?: string },
): Promise<LoginResult> {
  const user = await deps.db.user.findUnique({ where: { email: input.email } });
  // Réponse indifférenciée pour ne pas révéler l'existence d'un compte.
  if (!user || user.status === 'disabled') throw new AuthError('invalid_credentials');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AuthError('account_locked');
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  const secret = user.mfaSecretEnc ? decryptSecret(user.mfaSecretEnc, deps.encKeyHex) : null;
  const mfaOk =
    passwordOk &&
    user.status === 'active' &&
    secret !== null &&
    authenticator.verify({ token: input.code, secret });

  if (!passwordOk || !mfaOk) {
    const failures = user.failedLoginCount + 1;
    const locked = failures >= MAX_FAILURES_BEFORE_LOCK;
    await deps.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failures,
          lockedUntil: locked ? new Date(Date.now() + lockDurationMs(failures)) : null,
        },
      });
      await appendAudit(tx, {
        actorId: user.id,
        action: locked ? 'auth.login_locked' : 'auth.login_failed',
        ip: input.ip ?? null,
      });
    });
    if (!passwordOk) throw new AuthError('invalid_credentials');
    if (user.status === 'pending_mfa') throw new AuthError('mfa_required');
    throw new AuthError('mfa_invalid');
  }

  const token = newOpaqueToken();
  const expiresAt = new Date(Date.now() + deps.sessionTtlHours * 3_600_000);
  await deps.db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt,
        ip: input.ip ?? null,
      },
    });
    await appendAudit(tx, { actorId: user.id, action: 'auth.login', ip: input.ip ?? null });
  });
  return { token, expiresAt, userId: user.id };
}

export interface SessionInfo {
  userId: string;
  sessionId: string;
}

/** Valide un jeton et fait glisser l'expiration (session glissante 8 h). */
export async function authenticate(deps: AuthDeps, token: string): Promise<SessionInfo | null> {
  const session = await deps.db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status !== 'active') return null;
  // Invalidation à changement de mot de passe (§ D.5-2).
  if (session.user.passwordChangedAt > session.createdAt) return null;
  await deps.db.session.update({
    where: { id: session.id },
    data: { expiresAt: new Date(Date.now() + deps.sessionTtlHours * 3_600_000) },
  });
  return { userId: session.userId, sessionId: session.id };
}

export async function logout(deps: AuthDeps, token: string): Promise<void> {
  await deps.db.session.updateMany({
    where: { tokenHash: sha256Hex(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
