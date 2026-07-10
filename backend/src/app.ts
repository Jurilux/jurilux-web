import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { Env } from './env.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { LocalFsStorage, type StorageAdapter } from './storage.js';
import { registerEntityRoutes } from './routes/entityRoutes.js';
import {
  AuthError,
  activateMfa,
  authenticate,
  login,
  logout,
  register,
  type AuthDeps,
} from './modules/auth/service.js';
import { createOrganization, listUserEntities } from './modules/orgs/service.js';

// API REST versionnée /api/v1 (§ D.6). Validation zod systématique, deny by default :
// toute route hors liste publique exige une session valide.

export interface AppDeps {
  env: Env;
  db: Db;
  storage?: StorageAdapter;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().max(512),
});

const activateSchema = registerSchema.extend({ code: z.string().min(6).max(8) });
const loginSchema = activateSchema;

const createOrgSchema = z.object({
  name: z.string().min(1).max(200),
  practiceMode: z.enum(['individual', 'integrated_association', 'company', 'shared_costs']),
  partnerEntityNames: z.array(z.string().min(1).max(200)).max(50).optional(),
});

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.env.NODE_ENV !== 'test', trustProxy: true });
  const authDeps: AuthDeps = {
    db: deps.db,
    encKeyHex: deps.env.APP_ENC_KEY,
    sessionTtlHours: deps.env.SESSION_TTL_HOURS,
  };

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  // Uploads : 20 Mo max, un fichier par requête (§ D.5-5).
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 10 },
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, detail: err.detail });
    }
    if (err instanceof AuthError) {
      const status = err.code === 'account_locked' ? 423 : err.code === 'email_taken' ? 409 : 401;
      return reply
        .status(err.code === 'password_policy' ? 400 : status)
        .send({ error: err.code, detail: err.detail });
    }
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'validation', issues: err.issues });
    }
    // Erreurs client Fastify (corps illisible, charge trop grosse, rate limit…)
    const fastifyErr = err as { statusCode?: number; code?: string };
    if (typeof fastifyErr.statusCode === 'number' && fastifyErr.statusCode < 500) {
      return reply
        .status(fastifyErr.statusCode)
        .send({ error: fastifyErr.code ?? 'bad_request' });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'internal' });
  });

  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  // --- Authentification (routes publiques, rate-limitées plus sévèrement) ---
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/api/v1/auth/register', authLimit, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const result = await register(authDeps, body);
    return reply.status(201).send(result);
  });

  app.post('/api/v1/auth/mfa/activate', authLimit, async (req) => {
    const body = activateSchema.parse(req.body);
    await activateMfa(authDeps, body);
    return { activated: true };
  });

  app.post('/api/v1/auth/login', authLimit, async (req) => {
    const body = loginSchema.parse(req.body);
    return login(authDeps, { ...body, ip: req.ip });
  });

  // --- Garde d'authentification : tout ce qui suit exige une session valide ---
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/v1/auth/') || req.url === '/api/v1/health') return;
    const token = bearerToken(req);
    const session = token ? await authenticate(authDeps, token) : null;
    if (!session) {
      return reply.status(401).send({ error: 'unauthenticated' });
    }
    req.userId = session.userId;
  });

  app.post('/api/v1/auth/logout', async (req) => {
    const token = bearerToken(req);
    if (token) await logout(authDeps, token);
    return { loggedOut: true };
  });

  // --- Organisations & entités (M2) ---
  app.post('/api/v1/orgs', async (req, reply) => {
    const body = createOrgSchema.parse(req.body);
    const created = await createOrganization(deps.db, req.userId!, body);
    return reply.status(201).send(created);
  });

  app.get('/api/v1/me/entities', async (req) => {
    return listUserEntities(deps.db, req.userId!);
  });

  // --- Clients, dossiers, documents (M3/M4) ---
  registerEntityRoutes(app, {
    db: deps.db,
    storage: deps.storage ?? new LocalFsStorage(deps.env.DATA_DIR),
  });

  return app;
}
