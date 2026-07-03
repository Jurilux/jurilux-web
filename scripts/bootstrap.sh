#!/usr/bin/env bash
# Jurilux VPS bootstrap — idempotent. À lancer UNE fois sur un VPS Ubuntu neuf :
#   curl -fsSL https://raw.githubusercontent.com/Jurilux/jurilux-web/main/scripts/bootstrap.sh | sudo bash
# Met en place : utilisateur de déploiement + clé CI, Caddy, arborescence de release,
# script de bascule atomique, et une page placeholder servie sur dev.jurilux.lu et par IP.
set -euo pipefail

DEPLOY_USER=deploy
WEB_BASE=/var/www/juriscope/dev
GHA_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFrUu7KRpPyxMShgr9IZ4qvFnVCdpZ338yEiEn2NhXBD jurilux-gha"

echo "== 1. Utilisateur de déploiement =="
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
printf '%s\n' "$GHA_PUBKEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" > /etc/sudoers.d/jurilux-deploy
chmod 440 /etc/sudoers.d/jurilux-deploy
visudo -c >/dev/null

echo "== 2. Arborescence de release =="
mkdir -p "$WEB_BASE/releases"
# Placeholder si aucune release encore déployée
if [ ! -e "$WEB_BASE/current" ]; then
  PH="$WEB_BASE/releases/0000_placeholder"
  mkdir -p "$PH"
  cat > "$PH/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>Jurilux</title>
<body style="font-family:sans-serif;max-width:640px;margin:12vh auto;padding:0 1rem;color:#1c1c1a">
<h1>⚖ Jurilux</h1>
<p>Serveur opérationnel. En attente du premier déploiement du front via GitHub Actions.</p>
</body>
HTML
  ln -sfn "$PH" "$WEB_BASE/current"
fi
chown -R "$DEPLOY_USER:www-data" "$WEB_BASE/releases"
chmod -R g+rX "$WEB_BASE"

echo "== 3. Script de bascule atomique =="
cat > /usr/local/bin/jurilux-activate-release <<'SH'
#!/usr/bin/env bash
set -euo pipefail
ENVNAME="${1:?env}"; REL="${2:?release}"
BASE="/var/www/juriscope/${ENVNAME}"
test -d "${BASE}/releases/${REL}"
ln -sfn "${BASE}/releases/${REL}" "${BASE}/current"
cd "${BASE}/releases" && ls -1t | grep -v '^0000_placeholder$' | tail -n +6 | xargs -r rm -rf
echo "activated ${ENVNAME} -> ${REL}"
SH
chmod +x /usr/local/bin/jurilux-activate-release

echo "== 4. Caddy =="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== 5. Caddyfile =="
cat > /etc/caddy/Caddyfile <<'CADDY'
# Acces par IP (verification avant bascule DNS) — HTTP simple
:80 {
    handle /api/* {
        reverse_proxy 127.0.0.1:8088
    }
    handle {
        root * /var/www/juriscope/dev/current
        try_files {path} /index.html
        file_server
    }
}

# dev.jurilux.lu (TLS auto des que le DNS pointe ici)
dev.jurilux.lu {
    encode zstd gzip
    handle /health {
        reverse_proxy 127.0.0.1:8088
    }
    handle /api/* {
        reverse_proxy 127.0.0.1:8088
    }
    handle_path /docs/* {
        root * /data/pdfs
        file_server
    }
    handle {
        root * /var/www/juriscope/dev/current
        try_files {path} /index.html
        file_server
    }
}
CADDY

caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy

echo "== OK =="
echo "Test par IP : http://$(curl -4s ifconfig.me 2>/dev/null || echo IP)/"
