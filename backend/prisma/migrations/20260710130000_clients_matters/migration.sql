-- LexKYC — Sprints 1-2 : M3 clients & bénéficiaires effectifs, documents, M4 dossiers.
-- Toutes les tables portent entity_id ; RLS forcée, politiques identiques (§ D.5-3).

CREATE TYPE "ClientKind" AS ENUM ('natural', 'legal', 'arrangement');
CREATE TYPE "ClientStatus" AS ENUM ('active', 'archived');
CREATE TYPE "PepStatus" AS ENUM ('not_pep', 'pep', 'family_member', 'close_associate');
CREATE TYPE "LinkRole" AS ENUM ('self', 'beneficial_owner', 'representative', 'principal_director', 'settlor', 'trustee', 'protector', 'beneficiary');
CREATE TYPE "ScopingVerdict" AS ENUM ('in_scope', 'out_of_scope', 'exempt_defense', 'exempt_consultation');
CREATE TYPE "MatterCategory" AS ENUM ('real_estate', 'company_formation', 'pssf', 'family_office', 'tax_advice', 'asset_management', 'funds_of_third_parties', 'litigation', 'consultation', 'other');
CREATE TYPE "MatterStatus" AS ENUM ('draft', 'pending_cdd', 'active', 'under_review', 'closed');
CREATE TYPE "AvStatus" AS ENUM ('pending', 'clean', 'infected', 'skipped');

CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "kind" "ClientKind" NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "clients_entity_id_idx" ON "clients"("entity_id");

CREATE TABLE "persons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "first_names" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "birth_date" DATE,
    "birth_place" TEXT,
    "nationalities" TEXT[] NOT NULL DEFAULT '{}',
    "address_json" JSONB,
    "id_number" TEXT,
    "profession" TEXT,
    "pep_status" "PepStatus" NOT NULL DEFAULT 'not_pep',
    "pep_details_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "persons_entity_id_idx" ON "persons"("entity_id");

CREATE TABLE "legal_entity_parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "form" TEXT,
    "rcs_number" TEXT,
    "country" TEXT NOT NULL,
    "address_json" JSONB,
    "activity" TEXT,
    "activity_countries" TEXT[] NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legal_entity_parties_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "legal_entity_parties_entity_id_idx" ON "legal_entity_parties"("entity_id");

CREATE TABLE "client_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "person_id" UUID,
    "legal_party_id" UUID,
    "role" "LinkRole" NOT NULL,
    "ownership_pct" DECIMAL(5,2),
    "control_nature" TEXT,
    "justification" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_links_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_links_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_links_legal_party_id_fkey" FOREIGN KEY ("legal_party_id") REFERENCES "legal_entity_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_links_one_party" CHECK (num_nonnulls("person_id", "legal_party_id") = 1)
);
CREATE INDEX "client_links_entity_id_idx" ON "client_links"("entity_id");
CREATE INDEX "client_links_client_id_idx" ON "client_links"("client_id");

CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "expires_at" DATE,
    "issued_at" DATE,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "av_status" "AvStatus" NOT NULL DEFAULT 'skipped',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "documents_entity_id_idx" ON "documents"("entity_id");
CREATE INDEX "documents_entity_id_expires_at_idx" ON "documents"("entity_id", "expires_at");

CREATE TABLE "matters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scoping_verdict" "ScopingVerdict" NOT NULL,
    "scoping_answers_json" JSONB NOT NULL,
    "scoping_version" TEXT NOT NULL,
    "category" "MatterCategory" NOT NULL,
    "status" "MatterStatus" NOT NULL DEFAULT 'draft',
    "pssf" BOOLEAN NOT NULL DEFAULT false,
    "funds_origin" TEXT,
    "funds_origin_note" TEXT,
    "countries" TEXT[] NOT NULL DEFAULT '{}',
    "est_volume" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "retention_due_at" TIMESTAMP(3),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold_reason" TEXT,
    CONSTRAINT "matters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "matters_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "matters_entity_id_idx" ON "matters"("entity_id");
CREATE INDEX "matters_entity_id_status_idx" ON "matters"("entity_id", "status");

CREATE TABLE "scoping_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "verdict" "ScopingVerdict" NOT NULL,
    "answers_json" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "reason" TEXT,
    "decided_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scoping_revisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "scoping_revisions_entity_id_matter_id_idx" ON "scoping_revisions"("entity_id", "matter_id");

-- ============================================================================
-- Droits + RLS : même politique pour toutes les tables métier (entity_id ∈ contexte).
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','persons','legal_entity_parties','client_links','documents','matters','scoping_revisions']
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
