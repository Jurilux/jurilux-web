# Migration : sortie de Lovable — checklist ordonnée

Situation de départ : le front est hébergé par Lovable (`jurilux-ask.lovable.app`), les domaines `jurilux.lu` et `dev.jurilux.lu` pointent vers Lovable (`185.158.133.1`), les appels API passent par des edge functions Supabase. Cible : tout sur le VPS OVH, deploy automatique GitHub.

## Étape 1 — Nouveau repo (5 min, sur ton Mac)

Le repo `Jurilux/jurilux-web` existe déjà (désarchivé, vide). Dézipper `jurilux-web.zip` dans Documents, puis :

```bash
cd ~/Documents/jurilux-web
npm install          # crée package-lock.json (requis par le CI) 
npm run build        # vérifie que tout compile
git init -b main
git add -A
git commit -m "Jurilux web v1 — from scratch, same-origin, zéro Lovable"
git remote add origin https://github.com/Jurilux/jurilux-web.git
git push -u origin main
```

Le premier push fera échouer le job "Deploy" (secrets absents) : normal, le build lui doit passer au vert.

## Étape 2 — Préparer le VPS (15 min)

Suivre `RUNBOOK_VPS.md` sections 1 à 5. À la fin, le test `--resolve` doit renvoyer du JSON sur `/api/ask`.

## Étape 3 — Secrets GitHub (2 min)

Repo `jurilux-web` → Settings → Secrets and variables → Actions :

| Secret | Valeur |
|---|---|
| `DEPLOY_HOST` | IP du VPS OVH |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | clé privée générée au runbook §2 |
| `DEPLOY_PATH` | `/var/www/juriscope/dev` |

Puis relancer le workflow (Actions → Deploy DEV → Re-run). Les étapes build/upload/activate doivent passer ; le smoke test échouera tant que le DNS pointe encore vers Lovable — normal.

## Étape 4 — Bascule DNS (5 min, chez OVH)

Manager OVH → zone DNS `jurilux.lu` :

1. Enregistrement `A dev` : remplacer `185.158.133.1` par l'IP du VPS. TTL 300.
2. (Laisser `jurilux.lu` et `www` pour plus tard — la prod suivra le même chemin une fois DEV validé.)

Attendre la propagation (5–30 min) : `dig +short dev.jurilux.lu` doit renvoyer l'IP du VPS. Caddy émettra le certificat automatiquement à la première requête.

Validation : ouvrir https://dev.jurilux.lu → poser une question → réponse + sources + PDF s'ouvre.

## Étape 5 — Relancer le workflow complet

Actions → Deploy DEV → Re-run : tout doit être vert, smoke test inclus. À partir de maintenant : **modifier le code = push = en ligne 2 minutes plus tard**.

## Étape 6 — Décommissionner Lovable (quand DEV est validé)

1. Lovable → projet « Jurilux AI Assistant » → Settings → Domains : retirer `dev.jurilux.lu` et `jurilux.lu`.
2. Lovable → Settings → GitHub : déconnecter le repo `jurilux-ask` (évite tout commit accidentel).
3. Supabase Lovable Cloud : plus rien ne l'appelle (le nouveau front n'utilise ni `juriscope-proxy` ni `pdf-proxy`). Rien à faire, le projet peut rester dormant ou être supprimé.
4. `supabase.dev.jurilux.lu` (self-hosted, auth/historique de l'ancien front) : plus utilisé par la V1. À éteindre quand tu veux, ou à garder pour la V2 (comptes utilisateurs).
5. L'ancien repo `jurilux-ask` reste en archive (référence).

## Ce qu'on gagne

| Avant | Après |
|---|---|
| Lovable hosting + 2 edge functions + 2 Supabase | 1 VPS, 1 Caddy |
| Token API dans le front / proxy | Same-origin, zéro secret navigateur |
| CORS + ERR_BLOCKED_BY_CLIENT + pdf-proxy | PDFs servis par le même domaine |
| Deploy = prompt Lovable ou script manuel | `git push` |
| ~15 000 lignes (shadcn, router, i18n, auth, debug) | ~700 lignes lisibles |

## Suite (backlog, dans l'ordre)

1. Valider DEV avec les 10 questions de test du projet ChatGPT.
2. Backend : citations avec `chunk_id` + snippet systématique (déjà fait sur 8089, à porter sur 8088) ; bug `/health` gpt-3.5-turbo.
3. Prod : dupliquer le job Actions (`deploy-prod.yml`, path `/var/www/juriscope/prod`) + bloc Caddy `jurilux.lu` + bascule DNS apex/www.
4. V2 éventuelle : comptes utilisateurs + historique (côté backend FastAPI, pas de Supabase).
