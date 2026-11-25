#!/usr/bin/env bash
# Runs ON the Oracle Cloud Ubuntu 24.04 (ARM) server, from the project directory (~/kite-shop).
# Idempotent: safe to run again after every code update.
#
#   SITE_DOMAIN=kiteshop.duckdns.org ./deploy/oracle/server-install.sh
#
# First run only, to create the owner account (you change the password at first sign-in):
#   SITE_DOMAIN=... ADMIN_USERNAME=owner ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Temp#Pass2027' ./deploy/oracle/server-install.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- Docker
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker (Ubuntu packages)"
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2 docker-buildx iptables-persistent
  sudo systemctl enable --now docker
fi
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="sudo docker"; fi

# -------------------------------------------------------------- Firewall
# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
# The cloud "Security List" must ALSO allow TCP 80/443 (see docs/deployment-oracle.md).
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    log "Opening port $port in the server firewall"
    # Insert before Oracle's catch-all REJECT rule (append if there is none).
    pos=$(sudo iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')
    if [ -n "$pos" ]; then sudo iptables -I INPUT "$pos" -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    else sudo iptables -A INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT; fi
  fi
done
sudo netfilter-persistent save >/dev/null 2>&1 || true

# -------------------------------------------------------------- .env
if [ ! -f .env ]; then
  : "${SITE_DOMAIN:?Set SITE_DOMAIN, e.g. SITE_DOMAIN=kiteshop.duckdns.org}"
  log "Creating production .env for https://$SITE_DOMAIN (secrets generated on this server)"
  umask 077
  cat > .env <<EOF
NODE_ENV=production
SITE_DOMAIN=$SITE_DOMAIN
PUBLIC_API_URL=https://$SITE_DOMAIN
CORS_ORIGINS=https://$SITE_DOMAIN
COOKIE_SECURE=true
SWAGGER_ENABLED=false
LOG_LEVEL=info
POSTGRES_USER=kite
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_ACCESS_TTL_SECONDS=900
NEXT_PUBLIC_API_URL=/api/v1
EOF
else
  log ".env already exists — keeping it (secrets unchanged)"
fi

mkdir -p backups

# ----------------------------------------------------------- Build & run
if $DOCKER compose ps --status running db 2>/dev/null | grep -q db; then
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  log "Backing up the database before updating → backups/pre-deploy-$STAMP.dump"
  $DOCKER compose exec -T db pg_dump -U "$(grep '^POSTGRES_USER=' .env | cut -d= -f2)" -Fc kite > "backups/pre-deploy-$STAMP.dump"
fi

log "Building and starting the stack (first build takes ~10 minutes on the free ARM server)"
$DOCKER compose --profile app --profile prod up -d --build

log "Waiting for the API to become healthy"
for i in $(seq 1 90); do
  if $DOCKER compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "API is up"; break
  fi
  sleep 3
  if [ "$i" = 90 ]; then echo "API did not become healthy — check: $DOCKER compose logs api"; exit 1; fi
done

# ------------------------------------------------------- First admin
if [ -n "${ADMIN_USERNAME:-}" ]; then
  log "Creating the first Super Admin ($ADMIN_USERNAME) if none exists"
  $DOCKER compose exec -T \
    -e BOOTSTRAP_ADMIN_USERNAME="$ADMIN_USERNAME" \
    -e BOOTSTRAP_ADMIN_EMAIL="${ADMIN_EMAIL:?Set ADMIN_EMAIL}" \
    -e BOOTSTRAP_ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD}" \
    api node dist/database/seeds/prod-bootstrap.js
fi

DOMAIN=$(grep '^SITE_DOMAIN=' .env | cut -d= -f2)
log "Done. CRM: https://$DOMAIN   ·   iPhone app API URL: https://$DOMAIN/api/v1"
$DOCKER compose --profile app --profile prod ps
