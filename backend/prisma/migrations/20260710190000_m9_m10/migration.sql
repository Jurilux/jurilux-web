-- LexKYC — Sprints 7-8 : M9 ARG versionnée, M10 journal de purge.

CREATE TABLE "arg_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "answers_json" JSONB NOT NULL,
    "stats_json" JSONB NOT NULL,
    "conclusion" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arg_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "arg_documents_entity_id_version_key" ON "arg_documents"("entity_id", "version");

CREATE TABLE "purge_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "summary_json" JSONB NOT NULL,
    "purged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purge_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purge_log_entity_id_purged_at_idx" ON "purge_log"("entity_id", "purged_at");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['arg_documents','purge_log']
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
