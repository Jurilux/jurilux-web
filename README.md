# Jurilux Web

Front officiel de Jurilux — assistant juridique luxembourgeois (RAG sur jurisprudence + législation).

**Philosophie : le plus simple possible.** Vite + React + TypeScript, zéro framework UI, zéro Supabase, zéro proxy, zéro auth (V1). Toutes les requêtes sont **same-origin** : Caddy sur le VPS route `/api/*` vers le backend FastAPI, `/docs/*` vers les PDFs, et sert ce front en statique. Aucun secret côté navigateur.

## Développement local

```bash
npm install
npm run dev     # proxy /api et /docs vers le backend DEV (vite.config.ts)
```

## Déploiement

Automatique : chaque push sur `main` déclenche `.github/workflows/deploy-dev.yml` → build → rsync vers le VPS OVH → bascule atomique → smoke test. Voir `RUNBOOK_VPS.md` (préparation serveur, une seule fois).

## Structure

```
src/
  main.tsx          bootstrap React
  App.tsx           toute l'app (chat, sources, filtres, presets)
  api.ts            client /api/ask + /health + résolution URLs PDF
  juridictions.ts   libellés juridictions + parsing titres ELI
  styles.css        styles (CSS pur)
```

## Contrat API (backend FastAPI, port 8088 derrière Caddy)

`POST /api/ask` `{q, topK, temperature, filters?{year_min,year_max,juridiction_key}}` →
`{status: "ok"|"partial", answer, feedback?, citations[{doc_id, pdf_url?, title?, year, juridiction_key, source_type, content?}], refused}`

Règle produit : jamais de lien vers `anon.public.lu` — les PDFs jurisprudence sont servis par notre domaine (`/docs/<doc_id>.pdf`), les textes de loi via leur `pdf_url` Legilux filestore.
