# Optimisations relevées par le harnais E2E

Constats issus du parcours automatisé des 14 parcours utilisateurs (Chromium) + inspection
ciblée du code. Priorité décroissante. Chaque point donne le **constat**, la **preuve** et
le **correctif proposé**.

---

## 🔴 P1 — Vault, Rédiger et « Mon compte » sont inatteignables sur desktop

**Constat.** La barre latérale desktop (`.sidebar`, `App.tsx` ~673-690) ne liste que :
Recherche · Historique · Mon cabinet · Alertes · Insight · Administration. Les entrées
**🔒 Vault**, **✍️ Rédiger** et **⚙️ Mon compte** (donc clés d'API, bibliothèque de
prompts, export RGPD) n'existent QUE dans le tiroir mobile `☰` (`.nav-drawer`,
`App.tsx` ~806-816).

**Preuve.** `styles.css:381` `header.mobile-head { display:none }` et `styles.css:384`
`@media (max-width:900px){ .sidebar{display:none}; .mobile-head{display:flex} }`. Au-delà
de 900 px, le bouton `☰` est masqué → aucune porte d'entrée vers ces trois fonctionnalités
(seul `/vault` reste joignable en tapant l'URL). Les parcours E2E `11-rediger` et
`12-mon-compte` n'ont réussi qu'en forçant un viewport mobile.

**Impact.** Le desktop est l'appareil principal des cabinets. Trois pans du produit (Vault,
rédaction assistée, réglages compte/entreprise) sont invisibles pour l'utilisateur desktop.

**Correctif.** Ajouter ces entrées à la barre latérale desktop (section « Outils » ou « Mon
cabinet »), conditionnées à `user`/`plan` comme dans le tiroir. ~10 lignes dans `App.tsx`.

---

## 🟠 P2 — 404 favicon à chaque chargement

**Constat.** `index.html` ne déclare aucun `<link rel="icon">` alors que
`public/favicon.svg` existe et répond 200.

**Preuve.** Erreur console `Failed to load resource: 404` sur **tous** les parcours ; le
navigateur retombe sur `/favicon.ico` → 404 (vérifié : `/favicon.ico`=404,
`/favicon.svg`=200).

**Correctif.** Ajouter dans `<head>` : `<link rel="icon" href="/favicon.svg" />`. Supprime
l'erreur console et une requête inutile par visite.

---

## 🟡 P3 — Démarrage : requêtes de boot séparées

**Constat.** Au montage, le front appelle `/health`, `/api/corpus` et
`/api/auth/oidc/enabled` en trois allers-retours indépendants.

**Preuve.** Capture réseau au boot (le doublon `/health` ×2 et `/api/corpus` ×2 observé en
dev est un artefact **React StrictMode** — une seule fois en prod).

**Correctif (optionnel).** `/health` + `/api/corpus` sont mergeables en un
`/api/bootstrap` (statut dépendances + volumétrie corpus) ; `oidcEnabled` est cachable ou
différable au clic « Se connecter ». Gain marginal mais simplifie le time-to-interactive et
le code de démarrage.

---

## 🟢 Points déjà sains (à préserver)

- **Découpage de code correct.** Le build ne charge à l'accueil qu'**un bundle JS
  (~60 KB gzip) + un CSS** ; Admin, Vault, Insight, Cabinet, Draft, Account, Alerts, Legal
  sont en `lazy()` et ne se téléchargent qu'à l'usage (`npm run build` + service statique :
  5 requêtes, FCP ~140 ms en local).
- **Aucune erreur de page** (`pageerror`) sur les 14 parcours.
- **Parcours guidé (`follow_ups`) fonctionnel** de bout en bout, streaming compris.
- **`aria-label`** présents sur les boutons icônes (menu, fermeture).

## Idées d'amélioration continue (faible priorité)

- `modulepreload` du chunk `Vault` quand l'utilisateur connecté est `pro` (anticipe le clic).
- Marquer un élément hero pour rendre le **LCP mesurable** (actuellement `null` : contenu
  injecté par JS, pas d'élément LCP stable).
- Brancher `e2e/rapport.json` en **passerelle CI front** (échec si un parcours régresse ou
  si une nouvelle ressource 404 apparaît).
