import type { Db } from '../../db.js';
import { SYSTEM_ACTOR, withJobContext } from '../../db.js';
import { listSources } from '../../config/screening.js';
import { importList, runScreening } from '../screening/service.js';
import { runPurge } from '../retention/service.js';

// Jobs planifiés (Sprint 9) — ordonnanceur interne sans dépendance externe :
//  - téléchargement quotidien des listes UE/ONU (US-5.4) ;
//  - re-screening de TOUTES les entités quand une liste change + hebdo complet (US-5.6) ;
//  - purge automatique des dossiers à échéance (US-10.2).
// L'énumération des entités passe par le contexte job ; chaque entité est ensuite
// traitée dans son contexte tenant, l'acteur d'audit est SYSTEM_ACTOR.

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface JobReport {
  lists: { source: 'EU' | 'UN'; imported: boolean; entryCount?: number; error?: string }[];
  screenedEntities: number;
  newHits: number;
  purgedMatters: number;
  errors: string[];
}

async function allEntityIds(db: Db): Promise<string[]> {
  const rows = await withJobContext(db, (tx) =>
    tx.complianceEntity.findMany({ select: { id: true } }),
  );
  return rows.map((r) => r.id);
}

export async function downloadAndImportLists(db: Db, fetchImpl: FetchLike): Promise<JobReport['lists']> {
  const sources = listSources();
  const results: JobReport['lists'] = [];
  for (const source of ['EU', 'UN'] as const) {
    try {
      const res = await fetchImpl(sources[source]);
      if (!res.ok) {
        results.push({ source, imported: false, error: `HTTP ${res.status}` });
        continue;
      }
      const xml = await res.text();
      const imported = await importList(db, source, xml);
      results.push({ source, imported: !imported.skipped, entryCount: imported.entryCount });
    } catch (e) {
      results.push({ source, imported: false, error: String(e).slice(0, 300) });
    }
  }
  return results;
}

export async function reScreenAllEntities(db: Db): Promise<{ screened: number; newHits: number; errors: string[] }> {
  const entityIds = await allEntityIds(db);
  let newHits = 0;
  const errors: string[] = [];
  for (const entityId of entityIds) {
    try {
      const run = await runScreening(db, { userId: SYSTEM_ACTOR, entityIds: [entityId], orgIds: [] });
      newHits += run.newHits;
    } catch (e) {
      // Une entité sans liste importée ou vide ne doit pas stopper les autres.
      const msg = String(e);
      if (!msg.includes('no_lists_imported')) errors.push(`${entityId}: ${msg.slice(0, 200)}`);
    }
  }
  return { screened: entityIds.length, newHits, errors };
}

export async function autoPurgeAllEntities(db: Db): Promise<{ purged: number; errors: string[] }> {
  const entityIds = await allEntityIds(db);
  let purged = 0;
  const errors: string[] = [];
  for (const entityId of entityIds) {
    try {
      const result = await runPurge(db, { userId: SYSTEM_ACTOR, entityIds: [entityId], orgIds: [] });
      purged += result.purgedMatters.length;
    } catch (e) {
      errors.push(`${entityId}: ${String(e).slice(0, 200)}`);
    }
  }
  return { purged, errors };
}

/** Job quotidien complet. `force` re-screene même sans nouvelle liste (hebdo, US-5.6). */
export async function runDailyJobs(db: Db, fetchImpl: FetchLike, opts: { forceRescreen?: boolean } = {}): Promise<JobReport> {
  const lists = await downloadAndImportLists(db, fetchImpl);
  const listChanged = lists.some((l) => l.imported);
  let screenedEntities = 0;
  let newHits = 0;
  const errors: string[] = lists.filter((l) => l.error).map((l) => `${l.source}: ${l.error}`);

  if (listChanged || opts.forceRescreen) {
    const rescreen = await reScreenAllEntities(db);
    screenedEntities = rescreen.screened;
    newHits = rescreen.newHits;
    errors.push(...rescreen.errors);
  }

  const purge = await autoPurgeAllEntities(db);
  errors.push(...purge.errors);

  return { lists, screenedEntities, newHits, purgedMatters: purge.purged, errors };
}

/** Marqueur d'exécution (une fois par période, quel que soit le nombre d'instances). */
export async function shouldRun(db: Db, job: string, intervalHours: number): Promise<boolean> {
  const last = await db.jobRun.findUnique({ where: { job } });
  if (last && Date.now() - last.lastRunAt.getTime() < intervalHours * 3_600_000) return false;
  await db.jobRun.upsert({
    where: { job },
    create: { job, lastRunAt: new Date() },
    update: { lastRunAt: new Date() },
  });
  return true;
}

/** Ordonnanceur interne : vérifie toutes les heures ; quotidien + hebdo complet. */
export function startScheduler(db: Db, logger: { info: (o: object, msg: string) => void; error: (o: object, msg: string) => void }): NodeJS.Timeout {
  const tick = async () => {
    try {
      if (await shouldRun(db, 'daily', 24)) {
        const weekly = await shouldRun(db, 'weekly_full_rescreen', 24 * 7);
        const report = await runDailyJobs(db, fetch, { forceRescreen: weekly });
        logger.info({ report }, 'jobs quotidiens exécutés');
      }
    } catch (e) {
      logger.error({ err: String(e) }, 'échec des jobs planifiés');
    }
  };
  void tick();
  return setInterval(tick, 3_600_000);
}
