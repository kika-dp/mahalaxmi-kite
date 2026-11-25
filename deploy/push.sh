#!/usr/bin/env bash
# Runs on YOUR Mac. Copies the committed code (git HEAD) to the server and runs the installer there.
# Uncommitted changes, node_modules, .env files and local databases are never copied.
#
#   ./deploy/push.sh ubuntu@<server-ip> kiteshop.duckdns.org
#   ADMIN_USERNAME=owner ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Temp#Pass2027' ./deploy/push.sh ubuntu@<ip> kiteshop.duckdns.org
set -euo pipefail
TARGET="${1:?usage: deploy/push.sh ubuntu@<server-ip> <site-domain>}"
DOMAIN="${2:?usage: deploy/push.sh ubuntu@<server-ip> <site-domain>}"
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Note: you have uncommitted changes; only the last commit ($(git rev-parse --short HEAD)) is deployed."
fi

echo "==> Uploading $(git rev-parse --short HEAD) to $TARGET:~/kite-shop"
git archive --format=tar HEAD | ssh "$TARGET" 'mkdir -p ~/kite-shop && tar -x -C ~/kite-shop && chmod +x ~/kite-shop/deploy/oracle/*.sh ~/kite-shop/scripts/*.sh'

echo "==> Installing / updating on the server"
ssh -t "$TARGET" "cd ~/kite-shop && SITE_DOMAIN='$DOMAIN' ADMIN_USERNAME='${ADMIN_USERNAME:-}' ADMIN_EMAIL='${ADMIN_EMAIL:-}' ADMIN_PASSWORD='${ADMIN_PASSWORD:-}' ./deploy/oracle/server-install.sh"
