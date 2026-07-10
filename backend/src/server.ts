import { loadEnv } from './env.js';
import { createDb } from './db.js';
import { buildApp } from './app.js';
import { startScheduler } from './modules/jobs/service.js';
import { NoopMailer } from './mailer.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });

// Ordonnanceur interne (Sprint 9) : listes quotidiennes, re-screening, purge.
// Désactivable (SCHEDULER=off) pour les environnements multi-instances où un
// seul runner doit tourner ; job_runs déduplique de toute façon par période.
if (process.env.SCHEDULER !== 'off') {
  startScheduler(
    db,
    {
      info: (o, m) => app.log.info(o, m),
      error: (o, m) => app.log.error(o, m),
    },
    // SMTP branché au déploiement ; Noop journalise (aucune donnée nominative de toute façon).
    new NoopMailer((msg) => app.log.info({}, msg)),
  );
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
