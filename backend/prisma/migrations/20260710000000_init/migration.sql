-- LexKYC — migration initiale (Sprint 0)
-- Identités & accès (M1), entités de conformité (M2), sessions, journal d'audit chaîné (M10).
-- Sécurité : RLS FORCÉE sur toutes les tables portant compliance_entity_id (§ D.5-3),
-- journal d'audit append-only protégé par trigger (US-10.1).

CREATE TYPE "EntityType" AS ENUM ('individual', 'firm', 'shared_cost_partner');
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'lawyer', 'assistant', 'compliance', 'auditor');
CREATE TYPE "UserStatus" AS ENUM ('pending_mfa', 'active', 'disabled');

CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "billing_plan" TEXT NOT NULL DEFAULT 'trial',
    "practice_mode" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_entities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "type" "EntityType" NOT NULL,
    "name" TEXT NOT NULL,
    "rc_user_id" UUID,
    "rr_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_entities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compliance_entities_org_id_fkey" FOREIGN KEY ("org_id")
        REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "mfa_secret_enc" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'pending_mfa',
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "memberships" (
    "user_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("user_id", "entity_id"),
    CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "memberships_entity_id_fkey" FOREIGN KEY ("entity_id")
        REFERENCES "compliance_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "ip" TEXT,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "entity_id" UUID,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "object_type" TEXT,
    "object_id" TEXT,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_log_entity_id_fkey" FOREIGN KEY ("entity_id")
        REFERENCES "compliance_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "audit_log_entity_id_at_idx" ON "audit_log"("entity_id", "at");

-- Tête de chaîne (ligne unique) : lue et verrouillée FOR UPDATE à chaque insertion
-- d'événement pour garantir un chaînage linéaire, y compris sous RLS.
CREATE TABLE "audit_chain" (
    "id" INTEGER NOT NULL,
    "last_hash" TEXT NOT NULL,
    CONSTRAINT "audit_chain_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_chain_singleton" CHECK ("id" = 1)
);
INSERT INTO "audit_chain" ("id", "last_hash") VALUES (1, 'genesis');

-- ============================================================================
-- Journal d'audit append-only : aucune modification ni suppression possible,
-- même pour le propriétaire des tables (US-10.1).
-- ============================================================================
CREATE OR REPLACE FUNCTION lexkyc_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION lexkyc_audit_immutable();

-- ============================================================================
-- Rôle applicatif non privilégié. L'application se connecte via un utilisateur
-- LOGIN membre de ce rôle (créé par l'environnement : `CREATE USER ... IN ROLE lexkyc_app`).
-- La RLS s'applique à lui ; le rôle de migration reste propriétaire des tables.
-- ============================================================================
DO $$ BEGIN
  CREATE ROLE lexkyc_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO lexkyc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "organizations", "compliance_entities",
  "users", "memberships", "sessions" TO lexkyc_app;
-- Journal : INSERT et SELECT uniquement, jamais UPDATE/DELETE.
GRANT SELECT, INSERT ON "audit_log" TO lexkyc_app;
GRANT USAGE, SELECT ON SEQUENCE "audit_log_id_seq" TO lexkyc_app;
-- Tête de chaîne : lecture + mise à jour (aucune donnée métier, pas de RLS).
GRANT SELECT, UPDATE ON "audit_chain" TO lexkyc_app;

-- ============================================================================
-- Row-Level Security (§ D.5-3) — cloisonnement par compliance_entity_id.
-- Contexte de requête posé par l'application via SET LOCAL :
--   app.entity_ids    : liste CSV des entités auxquelles l'utilisateur appartient
--   app.org_ids       : liste CSV des organisations correspondantes
--   app.provisioning  : 'on' uniquement dans la transaction d'onboarding (création org/entités)
-- FORCE ROW LEVEL SECURITY : la politique s'applique aussi au propriétaire.
-- Les tables users/sessions ne sont pas tenant-scopées (nécessaires avant tout contexte).
-- ============================================================================
CREATE OR REPLACE FUNCTION lexkyc_ctx_uuids(guc text) RETURNS uuid[] AS $$
  SELECT COALESCE(
    (SELECT array_agg(x::uuid) FROM unnest(string_to_array(NULLIF(current_setting(guc, true), ''), ',')) AS x),
    ARRAY[]::uuid[]
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION lexkyc_provisioning() RETURNS boolean AS $$
  SELECT current_setting('app.provisioning', true) = 'on';
$$ LANGUAGE sql STABLE;

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_read ON "organizations" FOR SELECT
  USING ("id" = ANY (lexkyc_ctx_uuids('app.org_ids')));
CREATE POLICY org_write ON "organizations" FOR UPDATE
  USING ("id" = ANY (lexkyc_ctx_uuids('app.org_ids')));
CREATE POLICY org_insert ON "organizations" FOR INSERT
  WITH CHECK (lexkyc_provisioning());

ALTER TABLE "compliance_entities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance_entities" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_read ON "compliance_entities" FOR SELECT
  USING ("id" = ANY (lexkyc_ctx_uuids('app.entity_ids')));
CREATE POLICY entity_write ON "compliance_entities" FOR UPDATE
  USING ("id" = ANY (lexkyc_ctx_uuids('app.entity_ids')));
CREATE POLICY entity_insert ON "compliance_entities" FOR INSERT
  WITH CHECK (lexkyc_provisioning());

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
-- Lecture : ses propres rattachements (login, avant contexte) OU ceux des entités du contexte.
CREATE POLICY membership_read ON "memberships" FOR SELECT
  USING (
    "user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "entity_id" = ANY (lexkyc_ctx_uuids('app.entity_ids'))
  );
CREATE POLICY membership_insert ON "memberships" FOR INSERT
  WITH CHECK ("entity_id" = ANY (lexkyc_ctx_uuids('app.entity_ids')) OR lexkyc_provisioning());
CREATE POLICY membership_delete ON "memberships" FOR DELETE
  USING ("entity_id" = ANY (lexkyc_ctx_uuids('app.entity_ids')));

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON "audit_log" FOR SELECT
  USING ("entity_id" IS NOT NULL AND "entity_id" = ANY (lexkyc_ctx_uuids('app.entity_ids')));
CREATE POLICY audit_insert ON "audit_log" FOR INSERT
  WITH CHECK (
    "entity_id" = ANY (lexkyc_ctx_uuids('app.entity_ids'))
    OR lexkyc_provisioning()
    OR "entity_id" IS NULL
  );
