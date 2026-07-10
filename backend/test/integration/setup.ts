import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Prépare une base de test isolée : création de la base, application de la
// migration (avec RLS), création d'un utilisateur applicatif NON privilégié
// membre de lexkyc_app — c'est lui qu'utilisent les tests, pour que la RLS
// soit réellement exercée (§ D.5-3 : tests multi-tenant systématiques en CI).

const ADMIN_URL =
  process.env.LEXKYC_TEST_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const TEST_DB = 'lexkyc_test';
const APP_USER = 'lexkyc_test_app';
const APP_PASSWORD = 'lexkyc_test_password';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

/** Toutes les migrations, dans l'ordre chronologique de leur horodatage. */
function migrationFiles(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => join(migrationsDir, name, 'migration.sql'));
}

export interface TestDb {
  /** URL de connexion applicative (RLS appliquée). */
  appUrl: string;
  /** URL de connexion superuser sur la base de test (contourne la RLS — outillage/vérifications). */
  adminUrl: string;
  /** Client admin connecté à la base de test. */
  admin: pg.Client;
  close(): Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  const bootstrap = new pg.Client({ connectionString: ADMIN_URL });
  await bootstrap.connect();
  await bootstrap.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${TEST_DB}`);
  await bootstrap.end();

  const adminDbUrl = new URL(ADMIN_URL);
  adminDbUrl.pathname = `/${TEST_DB}`;
  const admin = new pg.Client({ connectionString: adminDbUrl.toString() });
  await admin.connect();
  for (const file of migrationFiles()) {
    await admin.query(readFileSync(file, 'utf8'));
  }
  await admin.query(`
    DO $$ BEGIN
      CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}' IN ROLE lexkyc_app;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  const appUrl = new URL(adminDbUrl.toString());
  appUrl.username = APP_USER;
  appUrl.password = APP_PASSWORD;

  return {
    appUrl: appUrl.toString(),
    adminUrl: adminDbUrl.toString(),
    admin,
    close: async () => {
      await admin.end();
    },
  };
}

export const TEST_ENC_KEY = 'f'.repeat(64);

export function testEnv(appUrl: string) {
  return {
    NODE_ENV: 'test' as const,
    PORT: 0,
    DATABASE_URL: appUrl,
    APP_ENC_KEY: TEST_ENC_KEY,
    SESSION_TTL_HOURS: 8,
  };
}
