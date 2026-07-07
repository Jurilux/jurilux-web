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

## Parcours couverts

Accueil · Question→parcours guidé (follow_ups) · clic question de suivi · mode pédagogique ·
feedback · partage/permalien · Insight avocats · inscription · connexion+historique · Vault ·
rédaction · Mon compte · backoffice admin (balayage des 11 onglets) · vue partagée publique.

> Extensible : ajouter un `await journey(browser, 'NN-nom', async (page) => { … })` dans
> `journeys.mjs`. Les captures et métriques sont automatiques.

## Notes de mesure

- Les métriques réseau/bundle en **dev Vite** ne reflètent PAS la prod (modules ES non
  minifiés servis à l'unité ; React StrictMode double les effets → double appel `/health`
  et `/api/corpus` visible seulement en dev). Pour un chiffre de bundle réaliste, mesurer
  sur `npm run build` servi statiquement.
