# Harnais E2E Chromium — parcours utilisateurs

Pilote **tous les parcours utilisateurs** de bout en bout dans un vrai Chromium, contre
l'application réelle (front Vite + backend FastAPI **stubé**, sans aucun service externe).
Chaque parcours produit une **capture d'écran**, un **temps de rendu**, les **erreurs
console/page** et un **résumé réseau** (requêtes lentes, ressources cassées).

## Prérequis

Deux serveurs locaux :

```bash
# 1) Backend de démo (app réelle, Meili/Anthropic/Ollama stubés, comptes+données seedés)
#    dans le dépôt jurilux-api :
python -m functional.e2e_server            # écoute 127.0.0.1:8088
#    → affiche l'ID du permalien de démo (SHARE_ID) et les comptes.

# 2) Front en dev, proxy /api vers le backend de démo (dans jurilux-web) :
API_TARGET=http://127.0.0.1:8088 npx vite --host 127.0.0.1 --port 5173
```

Comptes de démo (mot de passe `password123`) : `etudiant@demo.lu`, `pro@demo.lu`,
`admin@demo.lu`.

## Lancement

```bash
SHARE_ID=<id affiché par e2e_server> FRONT_URL=http://127.0.0.1:5173 \
  node e2e/journeys.mjs
```

Variables : `FRONT_URL` (défaut `http://127.0.0.1:5173`), `OUT_DIR` (défaut
`e2e/artifacts`), `ONLY=<sous-chaîne>` (ne jouer qu'un parcours, ex. `ONLY=13-admin`),
`SHARE_ID` (permalien à ouvrir dans le parcours 14).

## Sortie

- `e2e/artifacts/<parcours>.png` — capture pleine page de chaque parcours.
- `e2e/artifacts/rapport.json` — agrégat : succès/échec, perf, erreurs, réseau, ressources
  cassées. Exploitable pour un tableau de bord ou une passerelle CI.

## Parcours couverts (129, avec assertions)

Le socle (A–H, ~41 parcours) plus les **vagues** qui poussent vers le « tout-navigateur » :
- **Vague 2 — permissions & CRUD** : refus admin (non-admin/anonyme), Vault anonyme, contrôles
  cabinet masqués aux membres, CRUD workspace/membre+rôle/alerte/clé API/prompt, validations.
- **Vague 3 — Vault complet** : vérif. citations, extraction, contre-argumentaire, chronologie,
  recherche hybride, comparaison tabulaire, playbook, revue de contrat.
- **Vague 4 — recherche & insight** : filtres (type/année/juridiction), refus + « Élargir »,
  sauvegarde en dossier, historique, fiche avocat, analytics par matière.
- **Vague 5 — multi-acteurs** : nouveau client bout-en-bout ; collaboration cabinet ; cloison
  déontologique vérifiée sur 3 sessions (owner / collaborateur refusé / associé autorisé).
- **Vague 6 — sous-actions admin** : changer plan, basculer admin, inspecteur/probe, banc
  d'éval, PATCH config, suppression d'un compte.
- **Vague 7 — destructifs & erreurs** : supprimer dossier, quitter cabinet, révoquer accès,
  upload trop volumineux (413).
- **Vague 8 — insight & admin avancés** : comparaison d'avocats, filtre matière, onglets
  Questions/Retours/Corpus/Activité/Routage LLM, volumétrie corpus.
- **Vague 9 — variantes & compléments** : nav anonyme restreinte, suppression de doc Vault,
  vérification d'alertes, contenu de permalien, changement de mot de passe réussi.
- **Vague 10 — erreurs atteignables & variantes** : inscription/connexion rejetées, invitation
  d'un non-inscrit, autorisation d'un non-membre, Vault vide, recherche avocat sans résultat,
  tris Insight, filtre source « loi », filtres combinés.
- **Vague 11 — variantes recherche** : question d'exemple, conversation multi-tours, nouvelle
  recherche (reset), filtre projet de loi, champ « ce qui manquait », mentions légales.
- **Vague 12 — Vault profond** : chronologie sur document daté, suppression de playbook,
  comparaison de 3 documents, question hybride.
- **Vague 13 — Insight profond** : issue estimée, confrères, activité par année, répartition
  par juridiction, colonne taux (analytics).
- **Vague 14 — Admin profond** : entrées & filtre d'audit, éval détaillée, 2ᵉ question loguée,
  inspecteur avec topK.
- **Vague 15 — Cabinet profond** : ranger une réponse dans un dossier existant ou nouveau,
  gating des contrôles de cloison pour un membre.

## Gate CI

`node e2e/journeys.mjs` **sort avec un code non nul** si un parcours échoue ou si une page
plante — donc branchable tel quel dans un job CI (démarrer les deux serveurs, lancer le
runner, laisser le code de sortie casser le build). Le `rapport.json` sert d'artefact.

### Socle A–H

Organisés par domaine dans `journeys.mjs`, chacun **vérifie un résultat** (pas juste une capture) :

- **A. Service & recherche** (public) : accueil · parcours guidé · clic question de suivi ·
  autre angle · pédagogique · filtres · **refus hors-sujet** · feedback 👍 · feedback manquant ·
  partage (copie du lien) · permalien public.
- **B. Insight avocats** (public) : recherche d'avocat · analytics contentieux.
- **C. Auth & compte** : inscription · connexion · **mauvais mot de passe** · déconnexion ·
  changement de mot de passe · **épuisement du quota étudiant** (refus gracieux).
- **D. Cabinet, rôles & cloisons** : ouvrir · membres · **cloison — owner voit / collaborateur
  ne voit pas (404) / associé autorisé voit** · **isolation inter-cabinet**.
- **E. Veille** : liste des alertes · création.
- **F. Vault** : liste · dépôt · question isolée · analyse (résumé) · **isolation par propriétaire**.
- **G. Compte pro/entreprise** : clés d'API (liste + création) · prompts · export RGPD · rédaction.
- **H. Backoffice admin** : balayage des 11 onglets · utilisateurs · santé · audit.

Deux cabinets (Étude Dupont & Associés, Cabinet Weber), plusieurs profils (étudiant, pro, admin,
owner/associé/collaborateur), un dossier restreint et des Vault cloisonnés sont **seedés** par
`functional.e2e_server`.

> Extensible : ajouter un `await journey(browser, 'NN-nom', async (page) => { … })` dans
> `journeys.mjs` (helpers dans `lib.mjs` : `login`, `ask`, `menuItem`, `ouvrirCabinet`, `voir`,
> `absent`). Les captures et métriques sont automatiques.

## Ce que la suite a déjà trouvé

Une **fuite de cloison déontologique** (l'intitulé d'un dossier restreint était listé pour un
membre non autorisé) — corrigée côté backend, avec test de non-régression. Cf. `OPTIMISATIONS.md`.

## Notes de mesure

- Les métriques réseau/bundle en **dev Vite** ne reflètent PAS la prod (modules ES non
  minifiés servis à l'unité ; React StrictMode double les effets → double appel `/health`
  et `/api/corpus` visible seulement en dev). Pour un chiffre de bundle réaliste, mesurer
  sur `npm run build` servi statiquement.
