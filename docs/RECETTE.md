# Recette finale — critères d'acceptation globaux (§ D.9 du dossier produit)

État au 10/07/2026. Chaque critère est adossé à des tests automatisés exécutés en CI
(`backend/test/`), complétés de smoke tests HTTP de bout en bout pendant le développement.

| # | Critère (§ D.9) | État | Preuves automatisées |
|---|---|---|---|
| 1 | Contrôle CCBL simulé satisfait uniquement avec les exports du logiciel | ✅ (technique) | `reportsRetention.test.ts` (export CCBL : ARG + registres + dossiers + échantillon, DOS exclues) ; archive chiffrée testée dans `archiveMailer.test.ts` + smoke HTTP. Restera à valider avec un avocat pilote sur un contrôle à blanc. |
| 2 | Questionnaire annuel remplissable intégralement depuis le rapport généré | ✅ (technique) | `reportsRetention.test.ts` (agrégats traçables, CSV) ; mapping versionné `bar_questionnaire_mapping_2026.json`. À vérifier chaque année contre la structure réelle du questionnaire (Annexe 2). |
| 3 | Hit sanctions → dossier gelé + RC notifié < 1 minute après mise à jour des listes | ✅ | `screeningRisk.test.ts` + `sprint9.test.ts` : import de liste → re-screening automatique → hit → gel synchrone (même transaction). La notification in-app est immédiate ; l'e-mail immédiat suivra le branchement SMTP. |
| 4 | Aucun utilisateur non habilité ne peut détecter l'existence d'une DOS | ✅ | `vigilanceDosRegistries.test.ts` : test anti tipping-off automatisé (permissions refusées, aucune trace sur le dossier, contenu chiffré en base, accusé neutre). Test manuel à refaire avant lancement. |
| 5 | Deux associés en coûts partagés ne peuvent en aucun cas accéder aux données l'un de l'autre | ✅ | `tenantIsolation.test.ts` + `clientsMatters.test.ts` : RLS PostgreSQL forcée, vérifiée avec la connexion applicative non privilégiée (SELECT, UPDATE, INSERT, memberships, audit). |
| 6 | Purge à 5 ans démontrée sur un jeu de test, avec journal | ✅ | `reportsRetention.test.ts` : pièces supprimées, personnes/client anonymisés (vérifié en SQL brut), stats agrégées conservées, `purge_log` écrit, gel légal respecté, idempotence. |
| 7 | Onboarding d'un client in scope simple en < 10 minutes par un utilisateur non formé | ✅ (technique) | Flux « Nouveau dossier » : client rapide → 4 questions fermées → verdict expliqué → checklist. Le chrono réel doit être mesuré en test utilisateur (Annexe 2 : interviews). |

## Definition of Done transverse (§ D.8)

- Tests unitaires + intégration : **44 + 73 verts** en CI (base PostgreSQL éphémère, connexion non privilégiée).
- Contrôle d'accès testé y compris cross-tenant ; permissions deny-by-default testées unitairement.
- Événements d'audit émis sur toutes les écritures sensibles ; chaîne de hachés vérifiée ; journal append-only (trigger testé même en admin).
- i18n FR/EN sur tous les écrans ; aucune ressource externe côté front.
- `npm audit` sans vulnérabilité ≥ high (bloquant en CI).

## Hors périmètre automatisable (avant lancement)

Pentest externe, test de restauration des sauvegardes, contrôle CCBL à blanc avec un
avocat pilote, mesure du temps d'onboarding en conditions réelles, validation des
libellés de qualification par un avocat spécialisé (Annexe 2).
