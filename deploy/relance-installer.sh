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
-- =============================================================================
--  App « Relance » : relance des factures impayées
--  Schéma « relance » dans le Supabase partagé (à côté de public = Podo, clinique).
--  Rejouable sans risque (if not exists / create or replace).
--
--  Chaque entreprise ne voit que ses propres lignes (RLS sur entreprise_id = auth.uid()).
-- =============================================================================

create schema if not exists relance;
grant usage on schema relance to anon, authenticated, service_role;

-- Mon entreprise (1 ligne par compte)
create table if not exists relance.entreprises (
  id            uuid primary key references auth.users(id) on delete cascade,
  nom           text not null default '',
  email         text not null default '',
  telephone     text not null default '',
  signature     text not null default '',
  iban          text not null default '',
  lien_paiement text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Mes clients (ceux qui me doivent de l'argent)
create table if not exists relance.clients (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default auth.uid() references relance.entreprises(id) on delete cascade,
  nom           text not null check (length(trim(nom)) > 0),
  email         text not null default '',
  telephone     text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  unique (id, entreprise_id)
);
create unique index if not exists clients_nom_unique on relance.clients (entreprise_id, lower(trim(nom)));

-- Mes factures à encaisser
create table if not exists relance.factures (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default auth.uid() references relance.entreprises(id) on delete cascade,
  client_id     uuid not null,
  numero        text not null check (length(trim(numero)) > 0),
  montant       numeric(12, 2) not null check (montant > 0),
  emise_le      date not null default current_date,
  echeance      date not null,
  statut        text not null default 'a_payer' check (statut in ('a_payer', 'payee', 'litige', 'annulee')),
  payee_le      date,
  pause         boolean not null default false,   -- plus de relance pour cette facture
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  unique (id, entreprise_id),
  unique (entreprise_id, numero),
  foreign key (client_id, entreprise_id) references relance.clients (id, entreprise_id) on delete restrict
);
create index if not exists factures_entreprise_statut on relance.factures (entreprise_id, statut, echeance);

-- Mon scénario de relance : un mail type par étape (J+3, J+10, J+20…)
create table if not exists relance.etapes (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default auth.uid() references relance.entreprises(id) on delete cascade,
  jours         int not null check (jours between -60 and 365),  -- jours après l'échéance
  sujet         text not null default '',
  corps         text not null default '',
  unique (entreprise_id, jours)
);

-- Historique : chaque relance envoyée
create table if not exists relance.relances (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default auth.uid() references relance.entreprises(id) on delete cascade,
  facture_id    uuid not null,
  jours         int not null,                     -- étape envoyée (jours après échéance)
  canal         text not null default 'email' check (canal in ('email', 'telephone', 'courrier', 'autre')),
  envoyee_le    timestamptz not null default now(),
  foreign key (facture_id, entreprise_id) references relance.factures (id, entreprise_id) on delete cascade
);
create index if not exists relances_facture on relance.relances (facture_id);

-- Sécurité : chacun ne voit et ne modifie que ses lignes ----------------------------
alter table relance.entreprises enable row level security;
alter table relance.clients     enable row level security;
alter table relance.factures    enable row level security;
alter table relance.etapes      enable row level security;
alter table relance.relances    enable row level security;

drop policy if exists moi on relance.entreprises;
create policy moi on relance.entreprises for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['clients', 'factures', 'etapes', 'relances'] loop
    execute format('drop policy if exists moi on relance.%I', t);
    execute format('create policy moi on relance.%I for all to authenticated
      using (entreprise_id = (select auth.uid())) with check (entreprise_id = (select auth.uid()))', t);
  end loop;
end $$;

revoke all on all tables in schema relance from anon;
grant select, insert, update, delete on all tables in schema relance to authenticated;
grant all on all tables in schema relance to service_role;

-- updated_at automatique sur l'entreprise
create or replace function relance.maj_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists entreprises_updated_at on relance.entreprises;
create trigger entreprises_updated_at before update on relance.entreprises
  for each row execute function relance.maj_updated_at();
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
