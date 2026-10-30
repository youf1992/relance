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
