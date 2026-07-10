-- Exécuté au premier démarrage de PostgreSQL (docker-entrypoint-initdb.d).
-- Crée l'utilisateur applicatif LOGIN, membre du rôle lexkyc_app (créé par la
-- première migration). Le mot de passe est remplacé au déploiement :
--   ALTER ROLE lexkyc_app_user PASSWORD '<APP_DB_PASSWORD>';
DO $$ BEGIN
  CREATE ROLE lexkyc_app_user LOGIN PASSWORD 'changeme-au-deploiement';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Le GRANT du rôle lexkyc_app se fait après la première migration :
--   GRANT lexkyc_app TO lexkyc_app_user;
