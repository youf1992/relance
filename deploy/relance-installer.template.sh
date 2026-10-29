#!/bin/sh
# =============================================================================
# App « Relance » : installation / mise à jour dans le Supabase partagé (podo)
#
#   - crée ou met à jour le schéma « relance » (tables + sécurité) ; rejouable
#   - ajoute « relance » aux schémas de l'API et l'adresse de l'app aux redirections
#
# Usage, sur le VPS :  sh relance-installer.sh https://relance.xxx.workers.dev
# =============================================================================
set -eu
APP="${1:-}"; APP="${APP%/}"
die() { echo "ERREUR : $*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }
case "$APP" in https://*) ;; *) die "Indique l'adresse de l'app : sh $0 https://relance.xxx.workers.dev" ;; esac

docker inspect podo-db >/dev/null 2>&1 || die "Conteneur podo-db introuvable."
PODO=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' podo-db)
cd "$PODO"

log "Base de données (schéma relance)"
docker exec -i podo-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'RELANCE_SQL'
__SQL__
RELANCE_SQL
echo "  OK"

log "Réglages de l'API"
STAMP=$(date +%Y%m%d-%H%M%S)
cp .env ".env.avant-relance.$STAMP"
grep -q '^PGRST_DB_SCHEMAS=' .env || die "PGRST_DB_SCHEMAS absent de .env"
CHANGE=0
if ! grep -E '^PGRST_DB_SCHEMAS=.*(=|,|")relance(,|"|$)' .env >/dev/null; then
  sed -i -E 's/^PGRST_DB_SCHEMAS="?([^"]*)"?$/PGRST_DB_SCHEMAS=\1,relance/' .env; CHANGE=1
fi
if ! grep -q "^ADDITIONAL_REDIRECT_URLS=.*$APP" .env; then
  sed -i -E "s#^ADDITIONAL_REDIRECT_URLS=\"?([^\"]*)\"?\$#ADDITIONAL_REDIRECT_URLS=\1,$APP,$APP/**#" .env; CHANGE=1
fi
docker compose config -q || { cp ".env.avant-relance.$STAMP" .env; die "Configuration invalide, .env restauré."; }
if [ "$CHANGE" = 1 ]; then
  docker compose up -d --no-deps --force-recreate rest auth >/dev/null 2>&1
  echo "  API et comptes relancés."
else
  docker exec podo-db psql -U postgres -d postgres -q -c "notify pgrst, 'reload schema';" >/dev/null 2>&1 || true
  echo "  Déjà configuré."
fi
echo "  Schémas de l'API : $(sed -n 's/^PGRST_DB_SCHEMAS=//p' .env)"

sleep 4
ANON=$(sed -n 's/^ANON_KEY=//p' .env | tr -d '"')
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PODO_API_PORT:-8100}/rest/v1/factures?select=id&limit=1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Accept-Profile: relance" || true)
case "$CODE" in
  200|401) echo "  Test de l'API relance : OK (HTTP $CODE, les données sont protégées pour les visiteurs)" ;;
  *) echo "  Test de l'API relance : HTTP $CODE (inattendu : envoie-moi ce résultat)" ;;
esac
echo
echo "Terminé. Pense à ajouter l'adresse de l'app dans Cloudflare Turnstile (Hostnames)."
