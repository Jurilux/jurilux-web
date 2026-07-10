# Déploiement LexKYC

Cible : VM chez un hébergeur UE/Luxembourg (souveraineté, § D.5), Docker Compose.

## Première installation

```bash
# 1. Construire le front
npm ci && npm run build -w frontend

# 2. Configurer
cp deploy/.env.example deploy/.env   # renseigner mots de passe + APP_ENC_KEY (openssl rand -hex 32)

# 3. Lancer
cd deploy && docker compose up -d db
# Après la première migration (lancée par `api` au démarrage), relier le rôle applicatif :
docker compose up -d api   # exécute prisma migrate deploy puis démarre
docker compose exec db psql -U postgres -d lexkyc -c "GRANT lexkyc_app TO lexkyc_app_user;"
docker compose exec db psql -U postgres -d lexkyc -c "ALTER ROLE lexkyc_app_user PASSWORD '<APP_DB_PASSWORD>';"
docker compose restart api
docker compose up -d web
```

> Note : la migration s'exécute avec l'utilisateur de `DATABASE_URL`. Pour une
> séparation stricte migration/application, utiliser deux URLs (propriétaire pour
> `prisma migrate deploy`, applicatif pour le serveur) — variable `MIGRATE_DATABASE_URL`
> à introduire si besoin.

## Points de vigilance production

- **APP_ENC_KEY** : générée une fois, sauvegardée dans un coffre (KMS). Sa perte rend
  les DOS et secrets TOTP indéchiffrables.
- **Sauvegardes** (§ D.5-6) : `pg_dump` quotidien chiffré + volume `documents`,
  rétention 30 j + 12 mensuelles, test de restauration trimestriel documenté.
- **Listes de sanctions** : renseigner le jeton public de l'URL UE dans
  `backend/config/list_sources.json` ; vérifier dans les logs que le job quotidien importe.
- **E-mails** : brancher un adaptateur SMTP (interface `Mailer`) — le Noop journalise.
- **Antivirus** : brancher ClamAV sur l'upload (adaptateur à ajouter) — en attendant,
  `av_status='skipped'` est tracé sur chaque pièce.
- **Pentest** externe avant lancement commercial puis annuel (§ D.5-8).

## Smoke test post-déploiement

```bash
curl -s https://<SITE>/api/v1/health   # {"status":"ok"}
```
