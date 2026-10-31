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
