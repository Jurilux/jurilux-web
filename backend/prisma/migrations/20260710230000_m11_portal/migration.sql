-- LexKYC — M11 : portail client (lien magique, dépôts en propositions).

CREATE TYPE "SubmissionStatus" AS ENUM ('pending', 'accepted', 'rejected');

CREATE TABLE "portal_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "portal_links_token_hash_key" ON "portal_links"("token_hash");
CREATE INDEX "portal_links_entity_id_client_id_idx" ON "portal_links"("entity_id", "client_id");

CREATE TABLE "portal_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "document_id" UUID,
    "payload_json" JSONB,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_submissions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "portal_submissions_entity_id_status_idx" ON "portal_submissions"("entity_id", "status");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_links','portal_submissions']
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
  END LOOP;
END $$;
