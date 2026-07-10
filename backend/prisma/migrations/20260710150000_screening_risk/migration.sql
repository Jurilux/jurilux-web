-- LexKYC — Sprints 3-4 : M5 risque & screening.
-- Listes de sanctions = données publiques mondiales (pas de RLS, lecture/écriture app).
-- Runs, hits, évaluations de risque = tenant-scopés (RLS, politique uniforme).

CREATE TYPE "ListSource" AS ENUM ('EU', 'UN');
CREATE TYPE "HitStatus" AS ENUM ('open', 'false_positive', 'confirmed');
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

ALTER TABLE "matters" ADD COLUMN "remote_relationship" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "matters" ADD COLUMN "third_party_introducer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "matters" ADD COLUMN "frozen" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "list_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" "ListSource" NOT NULL,
    "version_tag" TEXT NOT NULL,
    "raw_checksum" TEXT NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "list_versions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "list_versions_source_imported_at_idx" ON "list_versions"("source", "imported_at");

CREATE TABLE "list_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "list_version_id" UUID NOT NULL,
    "source" "ListSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "names" TEXT[] NOT NULL DEFAULT '{}',
    "normalized_names" TEXT[] NOT NULL DEFAULT '{}',
    "birth_dates" TEXT[] NOT NULL DEFAULT '{}',
    "nationalities" TEXT[] NOT NULL DEFAULT '{}',
    "payload_json" JSONB,
    CONSTRAINT "list_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "list_entries_list_version_id_fkey" FOREIGN KEY ("list_version_id") REFERENCES "list_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "list_entries_list_version_id_idx" ON "list_entries"("list_version_id");

CREATE TABLE "screening_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "list_versions_json" JSONB NOT NULL,
    "algo_params_json" JSONB NOT NULL,
    "subject_count" INTEGER NOT NULL,
    "hit_count" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "screening_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "screening_runs_entity_id_started_at_idx" ON "screening_runs"("entity_id", "started_at");

CREATE TABLE "screening_hits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "list_source" "ListSource" NOT NULL,
    "list_external_id" TEXT NOT NULL,
    "list_entry_json" JSONB NOT NULL,
    "similarity" DECIMAL(5,4) NOT NULL,
    "status" "HitStatus" NOT NULL DEFAULT 'open',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "screening_hits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screening_hits_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "screening_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "screening_hits_entity_id_status_idx" ON "screening_hits"("entity_id", "status");
CREATE INDEX "screening_hits_entity_id_subject_id_list_external_id_idx" ON "screening_hits"("entity_id", "subject_id", "list_external_id");

CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "matrix_version" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "factors_json" JSONB NOT NULL,
    "override_level" "RiskLevel",
    "override_reason" TEXT,
    "override_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "risk_assessments_entity_id_matter_id_created_at_idx" ON "risk_assessments"("entity_id", "matter_id", "created_at");

-- Listes publiques : accès app sans RLS.
GRANT SELECT, INSERT ON "list_versions", "list_entries" TO lexkyc_app;

-- Tables tenant-scopées : droits + RLS uniforme.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['screening_runs','screening_hits','risk_assessments']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO lexkyc_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (entity_id = ANY (lexkyc_ctx_uuids(''app.entity_ids'')))',
      t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (entity_id = ANY (lexkyc_ctx_uuids(''app.entity_ids'')))',
      t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (entity_id = ANY (lexkyc_ctx_uuids(''app.entity_ids''))) WITH CHECK (entity_id = ANY (lexkyc_ctx_uuids(''app.entity_ids'')))',
      t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (entity_id = ANY (lexkyc_ctx_uuids(''app.entity_ids'')))',
      t || '_delete', t);
  END LOOP;
END $$;
