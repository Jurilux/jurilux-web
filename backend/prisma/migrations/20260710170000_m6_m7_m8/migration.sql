-- LexKYC — Sprints 5-6 : M6 vigilance continue, M7 DOS cloisonnée, M8 registres.

CREATE TYPE "DosStatus" AS ENUM ('internal', 'under_review', 'declared', 'no_declaration', 'closed');

ALTER TABLE "matters" ADD COLUMN "next_review_at" TIMESTAMP(3);

CREATE TABLE "periodic_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "checklist_json" JSONB NOT NULL,
    "notes" TEXT,
    "risk_level_after" TEXT NOT NULL,
    "next_due_at" TIMESTAMP(3) NOT NULL,
    "decided_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "periodic_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "periodic_reviews_entity_id_matter_id_idx" ON "periodic_reviews"("entity_id", "matter_id");

CREATE TABLE "suspicion_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "status" "DosStatus" NOT NULL DEFAULT 'internal',
    "decision_reason_enc" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "batonnier_sent_at" TIMESTAMP(3),
    "goaml_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suspicion_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "suspicion_reports_entity_id_status_idx" ON "suspicion_reports"("entity_id", "status");

CREATE TABLE "training_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "person_label" TEXT NOT NULL,
    "training_date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "organism" TEXT,
    "attestation_doc_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "training_records_entity_id_training_date_idx" ON "training_records"("entity_id", "training_date");

CREATE TABLE "pssf_mandates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "function" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "matter_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pssf_mandates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pssf_mandates_entity_id_idx" ON "pssf_mandates"("entity_id");

CREATE TABLE "rbe_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "checked_at" DATE NOT NULL,
    "extract_doc_id" UUID,
    "divergence" BOOLEAN NOT NULL DEFAULT false,
    "divergence_details" TEXT,
    "decision" TEXT,
    "reported" BOOLEAN NOT NULL DEFAULT false,
    "reported_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rbe_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rbe_checks_entity_id_client_id_idx" ON "rbe_checks"("entity_id", "client_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['periodic_reviews','suspicion_reports','training_records','pssf_mandates','rbe_checks']
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
