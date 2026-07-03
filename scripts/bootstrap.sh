#!/usr/bin/env bash
# Jurilux VPS bootstrap — idempotent.
set -euo pipefail
DEPLOY_USER=deploy
WEB_BASE=/var/www/juriscope/dev
GHA_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFrUu7KRpPyxMShgr9IZ4qvFnVCdpZ338yEiEn2NhXBD jurilux-gha"

echo "== 1. deploy user + SSH =="
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -s /bin/bash "$DEPLOY_USER"
HOME_DIR="/home/$DEPLOY_USER"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
printf "%s\n" "$GHA_PUBKEY" > "$HOME_DIR/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"
printf "%s ALL=(ALL) NOPASSWD:ALL\n" "$DEPLOY_USER" > /etc/sudoers.d/jurilux-deploy
chmod 440 /etc/sudoers.d/jurilux-deploy
visudo -c >/dev/null

echo "== 1b. sshd drop-in (pubkey + chemin standard + deploy autorise) =="
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-jurilux.conf <<CONF
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
CONF
if grep -RhE "^[[:space:]]*AllowUsers" /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null | grep -q . ; then
  grep -RlE "^[[:space:]]*AllowUsers" /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null | while read -r f; do
    grep -qw "$DEPLOY_USER" "$f" || sed -i "/^[[:space:]]*AllowUsers/ s/$/ $DEPLOY_USER/" "$f"
  done
fi
sshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true)
echo "-- authorized_keys --"; cat "$HOME_DIR/.ssh/authorized_keys"
echo "-- perms --"; ls -ld "$HOME_DIR" "$HOME_DIR/.ssh"; ls -l "$HOME_DIR/.ssh/authorized_keys"

echo "== 2. Arborescence de release =="
mkdir -p "$WEB_BASE/releases"
if [ ! -e "$WEB_BASE/current" ]; then
  PH="$WEB_BASE/releases/0000_placeholder"
  mkdir -p "$PH"
  printf "%s" "<!doctype html><meta charset=utf-8><title>Jurilux</title><body style=font-family:sans-serif;max-width:640px;margin:12vh_auto><h1>Jurilux</h1><p>Serveur operationnel.</p>" > "$PH/index.html"
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
    handle /api/* { reverse_proxy 127.0.0.1:8088 }
    handle { root * /var/www/juriscope/dev/current
        try_files {path} /index.html
        file_server }
}
dev.jurilux.lu {
    encode zstd gzip
    handle /health { reverse_proxy 127.0.0.1:8088 }
    handle /api/* { reverse_proxy 127.0.0.1:8088 }
    handle_path /docs/* { root * /data/pdfs
        file_server }
    handle { root * /var/www/juriscope/dev/current
        try_files {path} /index.html
        file_server }
}
CADDY
caddy fmt --overwrite /etc/caddy/Caddyfile || true
caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy
echo "== OK =="
