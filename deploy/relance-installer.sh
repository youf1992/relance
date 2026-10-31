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
-- =============================================================================
--  Relance : module pré-compta (dépenses, justificatifs, relevé bancaire)
--  Rejouable sans risque.
-- =============================================================================

-- Mes dépenses (factures fournisseurs, tickets…)
create table if not exists relance.depenses (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default auth.uid() references relance.entreprises(id) on delete cascade,
  fournisseur   text not null check (length(trim(fournisseur)) > 0),
  numero        text not null default '',
  date          date not null,
  ht            numeric(12, 2),
  tva           numeric(12, 2),
  ttc           numeric(12, 2) not null check (ttc <> 0),
  categorie     text not null default 'autre',
  piece         text,                              -- chemin du justificatif dans le stockage
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  unique (id, entreprise_id)
);
create index if not exists depenses_entreprise_date on relance.depenses (entreprise_id, date);

-- Lignes du relevé bancaire importé (CSV de la banque)
create table if not exists relance.banque_lignes (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default auth.uid() references relance.entreprises(id) on delete cascade,
  date          date not null,
  libelle       text not null default '',
  montant       numeric(12, 2) not null,           -- négatif = sortie, positif = entrée
  empreinte     text not null,                     -- évite d'importer deux fois la même ligne
  depense_id    uuid,
  facture_id    uuid,
  ignoree       boolean not null default false,    -- « pas besoin de justificatif » (virement interne…)
  created_at    timestamptz not null default now(),
  unique (entreprise_id, empreinte),
  foreign key (depense_id, entreprise_id) references relance.depenses (id, entreprise_id) on delete set null (depense_id),
  foreign key (facture_id, entreprise_id) references relance.factures (id, entreprise_id) on delete set null (facture_id)
);
create index if not exists banque_entreprise_date on relance.banque_lignes (entreprise_id, date);

alter table relance.depenses      enable row level security;
alter table relance.banque_lignes enable row level security;
do $$
declare t text;
begin
  foreach t in array array['depenses', 'banque_lignes'] loop
    execute format('drop policy if exists moi on relance.%I', t);
    execute format('create policy moi on relance.%I for all to authenticated
      using (entreprise_id = (select auth.uid())) with check (entreprise_id = (select auth.uid()))', t);
  end loop;
end $$;
revoke all on relance.depenses, relance.banque_lignes from anon;
grant select, insert, update, delete on relance.depenses, relance.banque_lignes to authenticated;
grant all on relance.depenses, relance.banque_lignes to service_role;

-- Justificatifs : bucket privé, un dossier par compte (dossier = identifiant du compte)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relance-pieces', 'relance-pieces', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "relance-pieces : lire" on storage.objects;
create policy "relance-pieces : lire" on storage.objects for select to authenticated
  using (bucket_id = 'relance-pieces' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "relance-pieces : envoyer" on storage.objects;
create policy "relance-pieces : envoyer" on storage.objects for insert to authenticated
  with check (bucket_id = 'relance-pieces' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "relance-pieces : supprimer" on storage.objects;
create policy "relance-pieces : supprimer" on storage.objects for delete to authenticated
  using (bucket_id = 'relance-pieces' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- =============================================================================
--  Relance : module devis (menuiserie / agencement sur mesure)
--  Catalogue de prix, temps de fabrication, devis, compteur de lecture de plans par IA.
--  Rejouable sans risque.
-- =============================================================================

-- Réglages de chiffrage : un seul par entreprise
create table if not exists relance.devis_reglages (
  entreprise_id    uuid primary key default auth.uid() references relance.entreprises(id) on delete cascade,
  taux_horaire     numeric(8, 2) not null default 45 check (taux_horaire >= 0),
  marge_pct        numeric(5, 2) not null default 30 check (marge_pct between 0 and 300),
  chute_pct        numeric(5, 2) not null default 15 check (chute_pct between 0 and 100),
  tva_pct          numeric(5, 2) not null default 20 check (tva_pct between 0 and 30),
  validite_jours   int not null default 30 check (validite_jours between 1 and 365),
  -- temps standards, en minutes
  min_coupe        numeric(6, 2) not null default 3,    -- sciage, par pièce
  min_chant_ml     numeric(6, 2) not null default 1.5, -- placage de chant, par mètre linéaire
  min_montage      numeric(6, 2) not null default 45,   -- montage, par caisson
  min_quincaillerie numeric(6, 2) not null default 5,   -- pose d'un accessoire (charnière, coulisse…)
  min_verification numeric(6, 2) not null default 10,   -- vérification, par caisson
  min_nettoyage    numeric(6, 2) not null default 10,   -- nettoyage, par caisson
  min_pose         numeric(6, 2) not null default 60,   -- pose chez le client, par caisson
  conditions       text not null default 'Acompte de 30 % à la commande, solde à la pose.',
  updated_at       timestamptz not null default now()
);

-- Catalogue : panneaux, chants, quincaillerie, accessoires…
create table if not exists relance.devis_articles (
  id            uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null default auth.uid() references relance.entreprises(id) on delete cascade,
  categorie     text not null default 'quincaillerie'
                check (categorie in ('panneau', 'chant', 'quincaillerie', 'accessoire', 'autre')),
  nom           text not null check (length(trim(nom)) > 0),
  fournisseur   text not null default '',
  unite         text not null default 'u' check (unite in ('u', 'ml', 'm2', 'panneau')),
  prix_ht       numeric(10, 2) not null default 0 check (prix_ht >= 0),
  longueur_mm   int,          -- format du panneau (ex. 2800 x 2070)
  largeur_mm    int,
  minutes_pose  numeric(6, 2) check (minutes_pose >= 0),  -- vide = temps standard « pose d'un accessoire »
  created_at    timestamptz not null default now()
);
alter table relance.devis_articles add column if not exists minutes_pose numeric(6, 2) check (minutes_pose >= 0);
create index if not exists devis_articles_entreprise on relance.devis_articles (entreprise_id, categorie);

-- Devis : les lignes (pièces, fournitures) sont gardées telles quelles en JSON
create table if not exists relance.devis (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null default auth.uid() references relance.entreprises(id) on delete cascade,
  client_id      uuid,
  numero         text not null,
  titre          text not null default '',
  date           date not null default current_date,
  statut         text not null default 'brouillon' check (statut in ('brouillon', 'envoye', 'accepte', 'refuse')),
  caissons       int not null default 1 check (caissons between 0 and 500),
  difficulte     numeric(4, 2) not null default 1 check (difficulte between 0.5 and 3),
  transport_ht   numeric(10, 2) not null default 0,
  heures_sup     numeric(8, 2) not null default 0,     -- temps ajouté à la main (finition, étude…)
  pieces         jsonb not null default '[]',
  fournitures    jsonb not null default '[]',
  notes          text not null default '',
  total_ht       numeric(12, 2) not null default 0,     -- figé à l'enregistrement, pour les listes
  total_ttc      numeric(12, 2) not null default 0,
  heures_prevues numeric(8, 2) not null default 0,
  heures_reelles numeric(8, 2),                          -- saisi après le chantier
  facture_id     uuid,
  created_at     timestamptz not null default now(),
  unique (entreprise_id, numero),
  foreign key (client_id, entreprise_id) references relance.clients (id, entreprise_id) on delete set null (client_id),
  foreign key (facture_id, entreprise_id) references relance.factures (id, entreprise_id) on delete set null (facture_id)
);
create index if not exists devis_entreprise_date on relance.devis (entreprise_id, date desc);

-- Lectures de plan par IA : compteur mensuel (écrit uniquement par le serveur)
create table if not exists relance.ia_usage (
  entreprise_id uuid not null references relance.entreprises(id) on delete cascade,
  mois          text not null,              -- AAAA-MM
  plans         int not null default 0,
  primary key (entreprise_id, mois)
);

alter table relance.devis_reglages enable row level security;
alter table relance.devis_articles enable row level security;
alter table relance.devis          enable row level security;
alter table relance.ia_usage       enable row level security;

drop policy if exists moi on relance.devis_reglages;
create policy moi on relance.devis_reglages for all to authenticated
  using (entreprise_id = (select auth.uid())) with check (entreprise_id = (select auth.uid()));
do $$
declare t text;
begin
  foreach t in array array['devis_articles', 'devis'] loop
    execute format('drop policy if exists moi on relance.%I', t);
    execute format('create policy moi on relance.%I for all to authenticated
      using (entreprise_id = (select auth.uid())) with check (entreprise_id = (select auth.uid()))', t);
  end loop;
end $$;
drop policy if exists lire on relance.ia_usage;
create policy lire on relance.ia_usage for select to authenticated using (entreprise_id = (select auth.uid()));

revoke all on relance.devis_reglages, relance.devis_articles, relance.devis, relance.ia_usage from anon;
grant select, insert, update, delete on relance.devis_reglages, relance.devis_articles, relance.devis to authenticated;
grant select on relance.ia_usage to authenticated;
grant all on relance.devis_reglages, relance.devis_articles, relance.devis, relance.ia_usage to service_role;

-- Compte une lecture de plan si la limite du mois n'est pas atteinte. Renvoie le nouveau total, ou -1.
create or replace function relance.compter_plan(p_entreprise uuid, p_limite int)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into relance.ia_usage (entreprise_id, mois, plans)
  values (p_entreprise, to_char(now(), 'YYYY-MM'), 1)
  on conflict (entreprise_id, mois) do update set plans = relance.ia_usage.plans + 1
    where relance.ia_usage.plans < p_limite
  returning plans into n;
  return coalesce(n, -1);
end $$;
revoke all on function relance.compter_plan(uuid, int) from public, anon, authenticated;
grant execute on function relance.compter_plan(uuid, int) to service_role;

-- Rend la lecture si l'IA a échoué (on ne compte que les lectures réussies)
create or replace function relance.rendre_plan(p_entreprise uuid)
returns void language sql security definer set search_path = '' as $$
  update relance.ia_usage set plans = greatest(plans - 1, 0)
  where entreprise_id = p_entreprise and mois = to_char(now(), 'YYYY-MM');
$$;
revoke all on function relance.rendre_plan(uuid) from public, anon, authenticated;
grant execute on function relance.rendre_plan(uuid) to service_role;

drop trigger if exists devis_reglages_updated_at on relance.devis_reglages;
create trigger devis_reglages_updated_at before update on relance.devis_reglages
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
