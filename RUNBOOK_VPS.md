# Runbook VPS — préparation OVH pour jurilux-web (une seule fois)

Objectif : `dev.jurilux.lu` servi par **ton VPS OVH** (plus par Lovable), front statique + API same-origin.

⚠️ **Important** : `dev.jurilux.lu` pointe aujourd'hui vers Lovable (A record `185.158.133.1`). On prépare tout le serveur d'abord, la bascule DNS est la dernière étape (voir MIGRATION.md) — zéro coupure.

À exécuter sur le VPS (`ssh ubuntu@mastermind`), bloc par bloc.

## 1. Arborescence de déploiement

```bash
sudo mkdir -p /var/www/juriscope/dev/releases
sudo chown -R www-data:www-data /var/www/juriscope/dev
```

## 2. Utilisateur `deploy` pour GitHub Actions

```bash
sudo adduser --system --group --home /home/deploy --shell /bin/bash deploy
sudo mkdir -p /home/deploy/.ssh
sudo touch /home/deploy/.ssh/authorized_keys
sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chown -R deploy:www-data /var/www/juriscope/dev/releases
```

Clé SSH dédiée à Actions :

```bash
ssh-keygen -t ed25519 -C "github-actions-jurilux" -f /tmp/gha_jurilux -N ""
sudo bash -c 'cat /tmp/gha_jurilux.pub >> /home/deploy/.ssh/authorized_keys'
echo "=== COPIE CE BLOC DANS LE SECRET GITHUB DEPLOY_SSH_KEY ==="
cat /tmp/gha_jurilux
rm /tmp/gha_jurilux /tmp/gha_jurilux.pub
```

## 3. Script de bascule atomique

```bash
sudo tee /usr/local/bin/jurilux-activate-release >/dev/null <<'SH'
#!/usr/bin/env bash
set -euo pipefail
ENVNAME="${1:?env (dev|test|prod)}"
REL="${2:?release dir}"
BASE="/var/www/juriscope/${ENVNAME}"
test -d "${BASE}/releases/${REL}"
ln -sfn "${BASE}/releases/${REL}" "${BASE}/current"
cd "${BASE}/releases" && ls -1t | tail -n +6 | xargs -r rm -rf
echo "activated ${ENVNAME} -> ${REL}"
SH
sudo chmod +x /usr/local/bin/jurilux-activate-release
echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/jurilux-activate-release' | sudo tee /etc/sudoers.d/jurilux-deploy
sudo chmod 440 /etc/sudoers.d/jurilux-deploy
```

## 4. Caddy — bloc `dev.jurilux.lu`

Vérifie d'abord où sont les PDFs : `ls /data/pdfs | head` (adapte `root` sinon).

```caddy
dev.jurilux.lu {
    encode zstd gzip

    # Santé backend (pour l'indicateur "Connecté" du front)
    handle /health {
        reverse_proxy 127.0.0.1:8088
    }

    # API same-origin -> backend jurisprudence+legilux (8088)
    handle /api/* {
        reverse_proxy 127.0.0.1:8088
    }

    # PDFs servis localement
    handle_path /docs/* {
        root * /data/pdfs
        file_server
        header Content-Type application/pdf
    }

    # Front (SPA)
    handle {
        root * /var/www/juriscope/dev/current
        try_files {path} /index.html
        file_server
    }
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 5. Test AVANT bascule DNS (en forçant la résolution)

```bash
IP_VPS="$(curl -4s ifconfig.me)"; echo "$IP_VPS"
curl -sk --resolve dev.jurilux.lu:443:$IP_VPS https://dev.jurilux.lu/health | head -c 200; echo
curl -sk --resolve dev.jurilux.lu:443:$IP_VPS -X POST https://dev.jurilux.lu/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"q":"licenciement faute grave","topK":3,"temperature":0}' | head -c 300
```

> Le certificat TLS pour dev.jurilux.lu ne sera émis par Caddy qu'après la bascule DNS ; un avertissement TLS ici est normal (`-k`).
