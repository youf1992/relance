#!/bin/sh
# =============================================================================
# Relance : lecture des plans d'architecte par IA pour le module Devis.
# Deux fournisseurs possibles, selon la clé donnée :
#   - OpenRouter (clé sk-or-...) : modèles GRATUITS par défaut (openrouter/free),
#     limités à 50 plans par jour sans crédit acheté, 1000 par jour avec 10 $ de crédit
#   - Google Gemini (clé AQ.... ou AIza...)
#
#   - range la clé dans le .env du Supabase podo (jamais dans l'app ni sur GitHub)
#   - installe la fonction serveur « relance-lire-plan »
#   - limite : PLANS_PAR_MOIS plans lus par entreprise et par mois (200 par défaut)
#
# Usage, sur le VPS :  sh relance-plans.sh LA_CLE   (OpenRouter ou Gemini)
# Options : PLANS_PAR_MOIS=300 sh relance-plans.sh LA_CLE   (changer la limite)
#           MODELE=google/gemini-3.8-flash sh relance-plans.sh sk-or-...   (modèle payant précis via OpenRouter)
#           SECOURS=google/gemini-3.8-flash sh relance-plans.sh sk-or-...   (gratuit d'abord, payant seulement si
#                                                                          les gratuits échouent : ≈1 centime)
#           MODELE=gemini-3.5-flash-lite sh relance-plans.sh AQ....          (plus de quota gratuit, moins précis)
#           sh relance-plans.sh --retirer                    (désactive la lecture des plans)
# Clés : https://openrouter.ai/settings/keys  ou  https://aistudio.google.com/apikey
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
  sed -i '/^GEMINI_API_KEY=/d;/^GEMINI_MODELE=/d;/^OPENROUTER_API_KEY=/d;/^OPENROUTER_MODELE=/d;/^OPENROUTER_SECOURS=/d;/^PLANS_PAR_MOIS=/d' .env
  rm -f "$FICHIER"
  rm -rf volumes/functions/relance-lire-plan
  docker compose up -d --no-deps --force-recreate functions >/dev/null 2>&1
  echo "  Fait."
  exit 0
fi

CLE="${1:-}"
LIMITE="${PLANS_PAR_MOIS:-200}"
case "$CLE" in
  sk-or-*)
    FOURNISSEUR=OpenRouter
    MODELE="${MODELE:-openrouter/free}"
    log "Test de la clé OpenRouter"
    CODE=$(curl -s -o /tmp/relance-cle.json -w '%{http_code}' -H "Authorization: Bearer $CLE" https://openrouter.ai/api/v1/key || true)
    [ "$CODE" = 200 ] || die "Clé refusée par OpenRouter (HTTP $CODE). Vérifie-la sur https://openrouter.ai/settings/keys"
    echo "  Clé valide. Modèle : $MODELE"
    rm -f /tmp/relance-cle.json
    LIGNES="OPENROUTER_API_KEY=$CLE
OPENROUTER_MODELE=$MODELE
OPENROUTER_SECOURS=${SECOURS:-}"
    [ -n "${SECOURS:-}" ] && echo "  Secours si les gratuits échouent : $SECOURS"
    ;;
  AIza*|AQ.*)
    FOURNISSEUR=Gemini
    MODELE="${MODELE:-${GEMINI_MODELE:-gemini-3.8-flash}}"
    log "Test de la clé Gemini (vraie question au modèle $MODELE)"
    REPONSE=$(curl -s -w '\n%{http_code}' -H "x-goog-api-key: $CLE" -H "Content-Type: application/json" \
      -d '{"contents":[{"parts":[{"text":"Réponds seulement : OK"}]}]}' \
      "https://generativelanguage.googleapis.com/v1beta/models/$MODELE:generateContent" || true)
    CODE=$(printf '%s' "$REPONSE" | tail -n1)
    MESSAGE=$(printf '%s' "$REPONSE" | grep -o '"message": *"[^"]*"' | head -1)
    case "$CODE" in
      200) echo "  Clé valide, le modèle $MODELE répond." ;;
      400|401|403) die "Clé refusée par Google (HTTP $CODE) $MESSAGE. Recopie-la en entier depuis https://aistudio.google.com/apikey (entre guillemets)" ;;
      404) die "Modèle $MODELE indisponible : $MESSAGE  → relance avec MODELE=<modèle conseillé> sh $0 \"LA_CLE\"" ;;
      429) die "Quota gratuit du modèle $MODELE épuisé pour aujourd'hui $MESSAGE. Essaie MODELE=gemini-3.5-flash-lite, ou réessaie demain." ;;
      *) die "Google ne répond pas (HTTP $CODE) $MESSAGE" ;;
    esac
    LIGNES="GEMINI_API_KEY=$CLE
GEMINI_MODELE=$MODELE"
    ;;
  *) die "Donne une clé OpenRouter (sk-or-...) ou Gemini (AQ.... ou AIza...) : sh $0 LA_CLE" ;;
esac

log "Réglages"
STAMP=$(date +%Y%m%d-%H%M%S)
cp .env ".env.avant-plans.$STAMP"
sed -i '/^GEMINI_API_KEY=/d;/^GEMINI_MODELE=/d;/^OPENROUTER_API_KEY=/d;/^OPENROUTER_MODELE=/d;/^OPENROUTER_SECOURS=/d;/^PLANS_PAR_MOIS=/d' .env
printf '%s\nPLANS_PAR_MOIS=%s\n' "$LIGNES" "$LIMITE" >> .env
# Variables vides pour l'autre fournisseur : une seule IA active à la fois
grep -q '^GEMINI_API_KEY=' .env || printf 'GEMINI_API_KEY=\nGEMINI_MODELE=gemini-3.8-flash\n' >> .env
grep -q '^OPENROUTER_API_KEY=' .env || printf 'OPENROUTER_API_KEY=\nOPENROUTER_MODELE=openrouter/free\nOPENROUTER_SECOURS=\n' >> .env
cat > "$FICHIER" <<'YML'
# Lecture des plans (app Relance, module Devis) : la clé reste dans .env, côté serveur.
services:
  functions:
    environment:
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      GEMINI_MODELE: ${GEMINI_MODELE}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      OPENROUTER_MODELE: ${OPENROUTER_MODELE}
      OPENROUTER_SECOURS: ${OPENROUTER_SECOURS}
      PLANS_PAR_MOIS: ${PLANS_PAR_MOIS}
YML
if grep -q '^COMPOSE_FILE=' .env; then
  grep -q "^COMPOSE_FILE=.*$FICHIER" .env || sed -i "s|^COMPOSE_FILE=\(.*\)$|COMPOSE_FILE=\1:$FICHIER|" .env
else
  printf 'COMPOSE_FILE=docker-compose.yml:%s\n' "$FICHIER" >> .env
fi
docker compose config -q || { cp ".env.avant-plans.$STAMP" .env; rm -f "$FICHIER"; die "Configuration invalide, rien n'a changé."; }
echo "  IA : $FOURNISSEUR ($MODELE). Limite : $LIMITE plans par entreprise et par mois."

log "Fonction serveur relance-lire-plan"
mkdir -p volumes/functions/relance-lire-plan
cat > volumes/functions/relance-lire-plan/index.ts <<'RELANCE_TS'
__FONCTION__
RELANCE_TS
docker compose up -d --no-deps --force-recreate functions >/dev/null 2>&1
echo "  Installée."
echo
echo "Terminé. Dans l'app Relance : Devis > Nouveau devis > « Lire un plan »."
[ "$FOURNISSEUR" = OpenRouter ] && [ "$MODELE" = openrouter/free ] && echo "Modèles gratuits : 50 plans par jour au total sans crédit acheté, qualité variable selon le modèle tiré au sort."
echo "Conseil : fixe un plafond de dépense chez le fournisseur pour ne jamais avoir de surprise."
echo "Pour changer d'IA plus tard : relance ce script avec l'autre clé."
echo "Pour désactiver : sh $0 --retirer"
