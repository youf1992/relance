#!/bin/sh
# =============================================================================
# Relance : lecture des plans d'architecte par IA (Google Gemini) pour le module Devis.
#
#   - range la clé Gemini dans le .env du Supabase podo (jamais dans l'app ni sur GitHub)
#   - installe la fonction serveur « relance-lire-plan »
#   - limite : PLANS_PAR_MOIS plans lus par entreprise et par mois (200 par défaut)
#
# Usage, sur le VPS :  sh relance-plans.sh LA_CLE_GEMINI
# Options : PLANS_PAR_MOIS=300 sh relance-plans.sh LA_CLE   (changer la limite)
#           GEMINI_MODELE=gemini-2.5-flash-lite sh relance-plans.sh LA_CLE   (moins cher, moins précis)
#           sh relance-plans.sh --retirer                    (désactive la lecture des plans)
# La clé se crée sur https://aistudio.google.com/apikey (gratuit pour commencer).
# =============================================================================
set -eu
die() { echo "ERREUR : $*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

docker inspect podo-db >/dev/null 2>&1 || die "Conteneur podo-db introuvable."
PODO=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' podo-db)
cd "$PODO"
FICHIER=docker-compose.podo-plans.yml

if [ "${1:-}" = "--retirer" ]; then
  log "Retrait de la lecture des plans"
  sed -i "s|:$FICHIER||" .env
  sed -i '/^GEMINI_API_KEY=/d;/^GEMINI_MODELE=/d;/^PLANS_PAR_MOIS=/d' .env
  rm -f "$FICHIER"
  rm -rf volumes/functions/relance-lire-plan
  docker compose up -d --no-deps --force-recreate functions >/dev/null 2>&1
  echo "  Fait."
  exit 0
fi

CLE="${1:-}"
case "$CLE" in
  AIza*) ;;
  *) die "Donne la clé Gemini (elle commence par AIza) : sh $0 AIza..." ;;
esac
MODELE="${GEMINI_MODELE:-gemini-2.5-flash}"
LIMITE="${PLANS_PAR_MOIS:-200}"

log "Test de la clé Gemini"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "x-goog-api-key: $CLE" \
  "https://generativelanguage.googleapis.com/v1beta/models/$MODELE" || true)
case "$CODE" in
  200) echo "  Clé valide, modèle $MODELE disponible." ;;
  400|403) die "Clé refusée par Google (HTTP $CODE). Vérifie-la sur https://aistudio.google.com/apikey" ;;
  404) die "Modèle $MODELE introuvable. Essaie GEMINI_MODELE=gemini-2.5-flash" ;;
  *) die "Google ne répond pas (HTTP $CODE). Vérifie la connexion du VPS." ;;
esac

log "Réglages"
STAMP=$(date +%Y%m%d-%H%M%S)
cp .env ".env.avant-plans.$STAMP"
sed -i '/^GEMINI_API_KEY=/d;/^GEMINI_MODELE=/d;/^PLANS_PAR_MOIS=/d' .env
printf 'GEMINI_API_KEY=%s\nGEMINI_MODELE=%s\nPLANS_PAR_MOIS=%s\n' "$CLE" "$MODELE" "$LIMITE" >> .env
cat > "$FICHIER" <<'YML'
# Lecture des plans (app Relance, module Devis) : la clé reste dans .env, côté serveur.
services:
  functions:
    environment:
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      GEMINI_MODELE: ${GEMINI_MODELE}
      PLANS_PAR_MOIS: ${PLANS_PAR_MOIS}
YML
if grep -q '^COMPOSE_FILE=' .env; then
  grep -q "^COMPOSE_FILE=.*$FICHIER" .env || sed -i "s|^COMPOSE_FILE=\(.*\)$|COMPOSE_FILE=\1:$FICHIER|" .env
else
  printf 'COMPOSE_FILE=docker-compose.yml:%s\n' "$FICHIER" >> .env
fi
docker compose config -q || { cp ".env.avant-plans.$STAMP" .env; rm -f "$FICHIER"; die "Configuration invalide, rien n'a changé."; }
echo "  Limite : $LIMITE plans par entreprise et par mois."

log "Fonction serveur relance-lire-plan"
mkdir -p volumes/functions/relance-lire-plan
cat > volumes/functions/relance-lire-plan/index.ts <<'RELANCE_TS'
__FONCTION__
RELANCE_TS
docker compose up -d --no-deps --force-recreate functions >/dev/null 2>&1
echo "  Installée."
echo
echo "Terminé. Dans l'app Relance : Devis > Nouveau devis > « Lire un plan »."
echo "Conseil : fixe un plafond de dépense dans Google AI Studio (Billing) pour ne jamais avoir de surprise."
echo "Pour désactiver : sh $0 --retirer"
