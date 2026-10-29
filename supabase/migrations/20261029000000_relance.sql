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
