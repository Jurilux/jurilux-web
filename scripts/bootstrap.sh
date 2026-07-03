#!/usr/bin/env bash
# Jurilux VPS bootstrap — idempotent.
#   curl -fsSL https://raw.githubusercontent.com/Jurilux/jurilux-web/HEAD/scripts/bootstrap.sh | sudo bash
set -euo pipefail

DEPLOY_USER=deploy
WEB_BASE=/var/www/juriscope/dev
GHA_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFrUu7KRpPyxMShgr9IZ4qvFnVCdpZ338yEiEn2NhXBD jurilux-gha"

echo "== 1. Utilisateur de deploiement + SSH =="
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -s /bin/bash "$DEPLOY_USER"
HOME_DIR="/home/$DEPLOY_USER"
mkdir -p "$HOME_DIR/.ssh"
printf "%s\n" "$GHA_PUBKEY" > "$HOME_DIR/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR"
chmod 755 "$HOME_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.ssh"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"
printf "%s ALL=(ALL) NOPASSWD:ALL\n" "$DEPLOY_USER" > /etc/sudoers.d/jurilux-deploy
chmod 440 /etc/sudoers.d/jurilux-deploy
visudo -c >/dev/null

echo "== 1b. sshd : autoriser pubkey + user deploy =="
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-jurilux.conf <<CONF
PubkeyAuthentication yes
CONF
# Si AllowUsers/AllowGroups restreint, ajouter deploy
if grep -RilE "^[[:space:]]*AllowUsers" /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null | grep -q . ; then
  grep -RlE "^[[:space:]]*AllowUsers" /etc/ssh/sshd_config /etc/ssh/sshd_config.d | while read f; do
    grep -qE "AllowUsers.*\\b$DEPLOY_USER\\b" "$f" || sed -i "s/^\\([[:space:]]*AllowUsers.*\\)/\\1 $DEPLOY_USER/" "$f"
  done
fi
if grep -RilE "^[[:space:]]*AllowGroups" /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null | grep -q . ; then
  usermod -aG "$(grep -RhE "^[[:space:]]*AllowGroups" /etc/ssh/sshd_config /etc/ssh/sshd_config.d | head -1 | awk "{print $2}")" "$DEPLOY_USER" || true
fi
sshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true)
echo "-- authorized_keys --"; cat "$HOME_DIR/.ssh/authorized_keys"
echo "-- perms --"; ls -ld "$HOME_DIR" "$HOME_DIR/.ssh"; ls -l "$HOME_DIR/.ssh/authorized_keys"

echo "== 2. Arborescence de release =="
mkdir -p "$WEB_BASE/releases"
if [ ! -e "$WEB_BASE/current" ]; then
  PH="$WEB_BASE/releases/0000_placeholder"
  mkdir -p "$PH"
  cat > "$PH/index.html" <<HTML
<!doctype html><meta charset="utf-8"><title>Jurilux</title>
<body style="font-family:sans-serif;max-width:640px;margin:12vh auto;padding:0 1rem;color:#1c1c1a">
<h1>Jurilux</h1><p>Serveur operationnel. En attente du premier deploiement.</p></body>
HTML
  ln -sfn "$PH" "$WEB_BASE/current"
fi
chown -R "$DEPLOY_USER:www-data" "$WEB_BASE/releases"
chmod -R g+rX "$WEB_BASE"

echo "== 3. Script de bascule atomique =="
cat > /usr/local/bin/jurilux-activate-release <<SH
#!/usr/bin/env bash
set -euo pipefail
ENVNAME="${1:?env}"; REL="${2:?release}"
BASE="/var/www/juriscope/${ENVNAME}"
test -d "${BASE}/releases/${REL}"
ln -sfn "${BASE}/releases/${REL}" "${BASE}/current"
cd "${BASE}/releases" && ls -1t | grep -v "^0000_placeholder$" | tail -n +6 | xargs -r rm -rf
echo "activated ${ENVNAME} -> ${REL}"
SH
chmod +x /usr/local/bin/jurilux-activate-release

echo "== 4. Caddy =="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== 5. Caddyfile =="
cat > /etc/caddy/Caddyfile <<CADDY
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
