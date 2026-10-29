#!/bin/sh
# =============================================================================
# Relance : lecture automatique des factures PDF par une petite IA open source,
# installée sur le VPS (Ollama + modèle Qwen3, licence Apache 2.0).
#
#   - ajoute le service « ollama » au Supabase podo (réseau interne : PAS accessible depuis internet)
#   - télécharge le modèle (≈1,4 Go) ; il occupe ≈2 Go de mémoire quand il travaille,
#     puis se décharge tout seul après 10 minutes sans demande
#   - installe la fonction serveur « relance-lire-facture »
#
# Usage, sur le VPS :  sh relance-ia.sh
# Options : MODELE=qwen3:4b sh relance-ia.sh   (plus précis, plus lent, ≈3,5 Go de mémoire)
#           sh relance-ia.sh --retirer         (enlève l'IA et libère la mémoire)
# =============================================================================
set -eu
MODELE="${MODELE:-qwen3:1.7b}"
IMAGE="${OLLAMA_IMAGE:-ollama/ollama:0.12.6}"
die() { echo "ERREUR : $*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

docker inspect podo-db >/dev/null 2>&1 || die "Conteneur podo-db introuvable."
PODO=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' podo-db)
cd "$PODO"
FICHIER=docker-compose.podo-ollama.yml

if [ "${1:-}" = "--retirer" ]; then
  log "Retrait de l'IA"
  docker compose stop ollama >/dev/null 2>&1 || true
  docker compose rm -f ollama >/dev/null 2>&1 || true
  sed -i "s|:$FICHIER||" .env
  rm -f "$FICHIER"
  docker compose up -d --no-deps --force-recreate functions >/dev/null 2>&1
  echo "  Fait. Le modèle téléchargé reste dans un volume Docker (docker volume ls | grep ollama) si tu veux le supprimer."
  exit 0
fi

log "Mémoire disponible"
DISPO=$(free -m | awk '/^Mem:/ {print $7}')
echo "  ${DISPO} Mo disponibles"
[ "${DISPO:-0}" -ge 2500 ] || [ "${FORCER:-}" = 1 ] ||
  die "Moins de 2,5 Go de mémoire libre : lance d'abord vps-alleger.sh (ou FORCER=1 sh $0)."

log "Service IA (Ollama, interne)"
STAMP=$(date +%Y%m%d-%H%M%S)
cp .env ".env.avant-ia.$STAMP"
cat > "$FICHIER" <<YML
# IA locale pour l'app Relance. Aucun port publié : seules les fonctions serveur y accèdent.
services:
  ollama:
    image: $IMAGE
    container_name: podo-ollama
    restart: unless-stopped
    environment:
      OLLAMA_KEEP_ALIVE: 10m
      OLLAMA_NUM_PARALLEL: "1"
      OLLAMA_MAX_LOADED_MODELS: "1"
    volumes:
      - ollama-modeles:/root/.ollama
    mem_limit: 3g
  functions:
    environment:
      OLLAMA_URL: http://ollama:11434
      OLLAMA_MODELE: $MODELE
volumes:
  ollama-modeles:
YML
if grep -q '^COMPOSE_FILE=' .env; then
  grep -q "^COMPOSE_FILE=.*$FICHIER" .env || sed -i "s|^COMPOSE_FILE=\(.*\)$|COMPOSE_FILE=\1:$FICHIER|" .env
else
  printf '\nCOMPOSE_FILE=docker-compose.yml:%s\n' "$FICHIER" >> .env
fi
docker compose config -q || { cp ".env.avant-ia.$STAMP" .env; rm -f "$FICHIER"; die "Configuration invalide, rien n'a changé."; }
annuler() {
  docker compose rm -sf ollama >/dev/null 2>&1 || true
  cp ".env.avant-ia.$STAMP" .env
  rm -f "$FICHIER"
  die "$1 Rien n'a changé pour tes apps."
}
docker compose up -d --no-deps ollama || annuler "Impossible de lancer Ollama (image $IMAGE)."
sleep 3

log "Téléchargement du modèle $MODELE (quelques minutes la première fois)"
docker exec podo-ollama ollama pull "$MODELE" || annuler "Téléchargement du modèle impossible."

log "Fonction serveur relance-lire-facture"
mkdir -p volumes/functions/relance-lire-facture
cat > volumes/functions/relance-lire-facture/index.ts <<'RELANCE_TS'
__FONCTION__
RELANCE_TS
docker compose up -d --no-deps --force-recreate functions >/dev/null 2>&1
echo "  Installée."

log "Test de l'IA (le premier essai charge le modèle en mémoire)"
DEBUT=$(date +%s)
REPONSE=$(docker exec podo-ollama ollama run "$MODELE" --think=false "Réponds seulement : OK" 2>/dev/null | tr -d '\n' | head -c 60 || true)
echo "  Réponse : ${REPONSE:-aucune} ($(( $(date +%s) - DEBUT )) s)"
echo "  Mémoire utilisée par l'IA : $(docker stats --no-stream --format '{{.MemUsage}}' podo-ollama)"
echo
echo "Terminé. Dans l'app Relance : Factures > + Facture > « Remplir depuis le PDF de la facture »."
echo "Pour retirer l'IA : sh $0 --retirer"
