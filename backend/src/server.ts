import { loadEnv } from './env.js';
import { createDb } from './db.js';
import { buildApp } from './app.js';

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
