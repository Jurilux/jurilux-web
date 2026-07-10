-- LexKYC — Sprint 9 : matrices de risque par entité (US-5.1), état des jobs
-- planifiés, contexte « job » pour l'énumération des entités (re-screening
-- automatique US-5.6 / purge automatique US-10.2).

CREATE TABLE "risk_matrices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "matrix_json" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_matrices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "risk_matrices_entity_id_version_key" ON "risk_matrices"("entity_id", "version");

DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON risk_matrices TO lexkyc_app';
  EXECUTE 'ALTER TABLE risk_matrices ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE risk_matrices FORCE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY risk_matrices_read ON risk_matrices FOR SELECT USING (entity_id = ANY (lexkyc_ctx_uuids(''app.entity_ids'')))';
  EXECUTE 'CREATE POLICY risk_matrices_insert ON risk_matrices FOR INSERT WITH CHECK (entity_id = ANY (lexkyc_ctx_uuids(''app.entity_ids'')))';
END $$;

-- État des jobs planifiés (ordonnanceur interne, un runner à la fois).
CREATE TABLE "job_runs" (
    "job" TEXT NOT NULL,
    "last_run_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("job")
);
GRANT SELECT, INSERT, UPDATE ON "job_runs" TO lexkyc_app;

-- Contexte job : les traitements planifiés (re-screening, purge) doivent pouvoir
-- ÉNUMÉRER les entités — uniquement leur identifiant, le reste passe ensuite par
-- un contexte tenant normal, entité par entité. Même modèle de confiance que
-- app.provisioning (défense en profondeur, pas frontière applicative).
CREATE OR REPLACE FUNCTION lexkyc_job() RETURNS boolean AS $$
  SELECT current_setting('app.job', true) = 'on';
$$ LANGUAGE sql STABLE;

DROP POLICY entity_read ON "compliance_entities";
CREATE POLICY entity_read ON "compliance_entities" FOR SELECT
  USING ("id" = ANY (lexkyc_ctx_uuids('app.entity_ids')) OR lexkyc_job());
