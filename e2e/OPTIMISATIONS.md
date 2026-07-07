# Optimisations relevées par le harnais E2E

Constats issus du parcours automatisé des 14 parcours utilisateurs (Chromium) + inspection
ciblée du code. Chaque point donne le **constat**, la **preuve**, le **correctif** et son
**statut**.

---

## 🔴 P1 — Vault, Rédiger et « Mon compte » inatteignables sur desktop · ✅ CORRIGÉ

**Constat.** La barre latérale desktop (`.sidebar`, `App.tsx`) ne listait que : Recherche ·
Historique · Mon cabinet · Alertes · Insight · Administration. Les entrées **🔒 Vault**,
**✍️ Rédiger** et **⚙️ Mon compte** (donc clés d'API, prompts, export RGPD) n'existaient que
dans le tiroir mobile `☰` (`.nav-drawer`).

**Preuve.** `styles.css` : `header.mobile-head { display:none }` et
`@media (max-width:900px){ .sidebar{display:none}; .mobile-head{display:flex} }`. Au-delà de
900 px le bouton `☰` est masqué → trois pans du produit invisibles sauf en tapant `/vault`.
Les parcours E2E `11-rediger` / `12-mon-compte` n'ont réussi qu'en forçant un viewport mobile.

**Correctif appliqué.** Section « Mes outils » ajoutée à la barre latérale desktop pour les
utilisateurs connectés (Vault, Rédiger, Mon compte), mêmes handlers que le tiroir.

---

## 🟠 P2 — Aucun favicon (404 à chaque chargement) · ✅ CORRIGÉ

**Constat.** Erreur console `Failed to load resource: 404` sur **tous** les parcours : aucun
favicon n'était livré (pas de `public/`, rien dans `dist/`, aucun `<link rel="icon">`) → le
navigateur tape `/favicon.ico` = 404. Un simple lien vers `/favicon.svg` n'aurait rien réglé :
**le fichier n'existait pas** (il aurait 404 aussi en prod).

**Correctif appliqué.** Ajout d'un vrai `public/favicon.svg` (marque « J » sur navir de marque
`#17365c`, copié dans `dist/` par Vite) + `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
dans `index.html`. Supprime l'erreur console et la requête 404.

---

## 🟢 P3 — Requêtes de démarrage · ✅ DÉJÀ OPTIMAL EN PROD (aucun changement)

**Vérification.** Le doublon `/health` ×2 et `/api/corpus` ×2 observé au boot est un artefact
**React StrictMode** (dev uniquement) — une seule fois chacun en prod. `oidcEnabled()` est
déjà **paresseux** : appelé dans `AuthModal`, il ne part qu'à l'ouverture de la fenêtre de
connexion, pas au boot (confirmé : absent de la capture réseau de démarrage). Le démarrage se
limite donc à `health` + `corpus`, tous deux nécessaires au premier rendu.

**Décision.** Pas de fusion `health`+`corpus` en un endpoint : gain réseau marginal contre une
surface d'API supplémentaire, à rebours de la sobriété du projet. **Rien à corriger.**

---

## 🟢 Points déjà sains (préservés)

- **Découpage de code correct** : accueil = 1 bundle JS (~60 KB gzip) + 1 CSS ; Admin, Vault,
  Insight, Cabinet, Draft, Account, Alerts, Legal en `lazy()` (mesuré sur `npm run build`
  servi statiquement : 5 requêtes, FCP ~140 ms en local).
- **Zéro erreur de page** (`pageerror`) sur les 14 parcours.
- **Parcours guidé (`follow_ups`)** fonctionnel de bout en bout, streaming compris.
- **`aria-label`** présents sur les boutons icônes (menu, fermeture).

## Idées d'amélioration continue (faible priorité, non faites)

- `modulepreload` du chunk `Vault` quand l'utilisateur connecté est `pro`.
- Marquer un élément hero pour rendre le **LCP mesurable** (actuellement `null`).
- Brancher `e2e/rapport.json` en **passerelle CI front** (échec si un parcours régresse ou si
  une ressource 404 réapparaît).
