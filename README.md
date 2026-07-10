# LexKYC

Solution KYC/LBC-FT **simple et sécurisée** pour les avocats et études d'avocats du Barreau de Luxembourg : onboarding client, vigilance continue, et production des déclarations et rapports exigés par l'Ordre (CCBL).

Le dossier produit complet (marché, concurrence, modèle économique, spécifications) est dans [`docs/dossier-produit-lexkyc.md`](docs/dossier-produit-lexkyc.md).

## Principes (§ D.0 du dossier)

1. **Simplicité d'abord** — parcours guidés, vocabulaire de l'avocat, défauts conformes.
2. **Sécurité par conception** — chiffrement systématique, cloisonnement strict, journal inaltérable.
3. **Opposabilité** — tout ce qui sort du logiciel est montrable tel quel à la CCBL ou au Bâtonnier.
4. **Souveraineté** — hébergement UE, aucune donnée hors UE, dépendances auditées.

## État — Sprints 1-2 (M3 clients & BE + M4 dossiers) ✅

- **M3 Clients & bénéficiaires effectifs** : clients PP (création minimale + indicateur de complétude), PM et constructions juridiques, liens BE avec règle > 25 % / contrôle par d'autres moyens, dirigeant principal à justification obligatoire (US-3.3), rôles de trust (settlor/trustee/protector/bénéficiaire).
- **Documents** : upload multipart (type MIME vérifié sur le contenu réel, taille plafonnée, checksum), suivi d'expiration (J-60 paramétré), stockage par adaptateur (`LocalFsStorage` en V1, S3/MinIO à venir), `av_status` tracé.
- **M4 Dossiers** : qualification in/out scope à l'ouverture (`scoping.ts`, logique pure versionnée + table de vérité testée), re-qualification tracée (`ScopingRevision`), statuts `draft → pending_cdd → active → closed`, activation refusée sans champs de vigilance (US-4.2) ni BE vérifié/dirigeant justifié (US-3.3), marquage PSSF automatique, clôture = départ de la conservation 5 ans (paramétrée).
- **Référentiel réglementaire externalisé** : `config/regulatory_defaults.json` (seuil BE, durées, périodicités de revue) — rien en dur (§ D.1).
- **Front** : espace de travail par entité — clients, flux « Nouveau dossier » avec questionnaire de qualification et verdict expliqué en langage clair (§ D.7-2), activation/clôture.

## État — Sprint 0 (fondations) ✅

- Monorepo npm workspaces : `backend/` (Fastify + Prisma + PostgreSQL 16) et `frontend/` (Vite + React + TS, i18n FR/EN).
- **M1 Identités & accès** : inscription, **MFA TOTP obligatoire** (compte inactif tant que non enrôlé), sessions opaques glissantes 8 h révocables, verrouillage progressif après 5 échecs, politique de mots de passe (≥ 12 caractères + liste de mots de passe compromis), invalidation des sessions au changement de mot de passe.
- **M2 Entités de conformité** : `Organization` → `ComplianceEntity`, assistant d'onboarding par mode d'exercice, **coûts partagés = une entité étanche par associé**.
- **Matrice de permissions** (`backend/src/permissions.ts`) : deny by default, testée unitairement.
- **Row-Level Security PostgreSQL forcée** sur toutes les tables tenant-scopées, alimentée par `SET LOCAL` — testée en intégration avec une connexion applicative non privilégiée (critère d'acceptation n°5 : deux associés en coûts partagés ne voient jamais les données l'un de l'autre).
- **Journal d'audit** append-only à chaînage de hachés, protégé par trigger (UPDATE/DELETE impossibles même en admin), tête de chaîne sérialisée `FOR UPDATE`.
- CI GitHub Actions : audit dépendances, typecheck, tests unitaires + intégration (Postgres 16 de service), build.

## Développement local

```bash
npm install
npm run prisma:generate -w backend

# Base de données (PostgreSQL 16) : appliquer backend/prisma/migrations puis créer
# l'utilisateur applicatif non privilégié :
#   CREATE ROLE lexkyc_app_user LOGIN PASSWORD '...' IN ROLE lexkyc_app;
cp backend/.env.example backend/.env   # puis renseigner DATABASE_URL et APP_ENC_KEY

npm run dev:api   # backend sur :8080
npm run dev:web   # frontend sur :5173 (proxy /api → :8080)
```

## Tests

```bash
npm test                                          # unitaires (sans base)
LEXKYC_TEST_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres \
  npm run test:integration                        # RLS multi-tenant, auth MFA, audit
```

Les tests d'intégration créent une base `lexkyc_test` jetable et s'y connectent avec un utilisateur **non privilégié** membre de `lexkyc_app`, pour que la RLS soit réellement exercée.

## Sécurité — décisions structurantes

- L'application se connecte à PostgreSQL avec un rôle **non propriétaire** (`lexkyc_app`) : les politiques RLS s'appliquent même en cas de bug applicatif (`FORCE ROW LEVEL SECURITY`).
- Le contexte tenant (`app.entity_ids`, `app.org_ids`, `app.user_id`) est posé par transaction (`SET LOCAL`), jamais par session.
- Les secrets TOTP sont chiffrés AES-256-GCM avec une clé applicative (`APP_ENC_KEY`, à terme KMS) ; les jetons de session ne sont stockés qu'en SHA-256 ; les mots de passe en scrypt.
- Aucun paramètre réglementaire codé en dur : seuils, durées et listes vivront en configuration versionnée (§ D.1).

## Prochaines étapes (plan § D.8)

- **Sprints 3-4 (M5)** : import quotidien des listes de sanctions UE/ONU (versionnées), moteur de matching (normalisation Unicode, Jaro-Winkler, discriminants), alertes bloquantes (dossier gelé + notification RC < 1 min), scoring configurable (`risk_matrix_default.json`), vigilance renforcée PEP/pays à haut risque.
- Puis : échéancier (M6), DOS cloisonnée + tests anti tipping-off (M7), registres (M8), rapport questionnaire annuel (M9), conservation/purge (M10).
- Dette assumée V1 locale : antivirus non branché (`av_status='skipped'` tracé), RBE/divergences (US-3.4) avec le registre M8, page « fiche client » détaillée côté front.
