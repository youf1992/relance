-- =============================================================================
--  Relance : administration (limite de plans lus par IA, par défaut et par client)
--  Seuls les comptes listés dans relance.admins y ont accès, et uniquement par les
--  fonctions ci-dessous (vérification côté base : impossible à contourner depuis l'app).
--  Rejouable sans risque.
-- =============================================================================

-- Administrateurs (par adresse email du compte de connexion)
create table if not exists relance.admins (
  email text primary key check (email = lower(email))
);
insert into relance.admins (email) values ('nostika1992@gmail.com') on conflict do nothing;
alter table relance.admins enable row level security;
revoke all on relance.admins from anon, authenticated;
grant all on relance.admins to service_role;

-- Réglages généraux (une seule ligne)
create table if not exists relance.parametres (
  id              boolean primary key default true check (id),
  plans_par_mois  int not null default 200 check (plans_par_mois between 0 and 100000)
);
insert into relance.parametres (id) values (true) on conflict do nothing;
alter table relance.parametres enable row level security;
drop policy if exists lire on relance.parametres;
create policy lire on relance.parametres for select to authenticated using (true);
revoke all on relance.parametres from anon;
grant select on relance.parametres to authenticated;
grant all on relance.parametres to service_role;

-- Limite propre à un client (absente = limite par défaut). Le client peut la lire, pas la changer.
create table if not exists relance.ia_limites (
  entreprise_id  uuid primary key references relance.entreprises(id) on delete cascade,
  plans_par_mois int not null check (plans_par_mois between 0 and 100000)
);
alter table relance.ia_limites enable row level security;
drop policy if exists lire on relance.ia_limites;
create policy lire on relance.ia_limites for select to authenticated using (entreprise_id = (select auth.uid()));
revoke all on relance.ia_limites from anon;
grant select on relance.ia_limites to authenticated;
grant all on relance.ia_limites to service_role;

-- Suis-je administrateur ?
create or replace function relance.suis_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from relance.admins a join auth.users u on lower(u.email) = a.email
    where u.id = auth.uid()
  );
$$;
revoke all on function relance.suis_admin() from public, anon;
grant execute on function relance.suis_admin() to authenticated, service_role;

-- Limite du mois pour une entreprise : la sienne, sinon celle par défaut
create or replace function relance.limite_plans(p_entreprise uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select plans_par_mois from relance.ia_limites where entreprise_id = p_entreprise),
    (select plans_par_mois from relance.parametres where id),
    200
  );
$$;
revoke all on function relance.limite_plans(uuid) from public, anon, authenticated;
grant execute on function relance.limite_plans(uuid) to service_role;

-- Vue d'ensemble pour l'écran Admin
create or replace function relance.admin_vue() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  if not relance.suis_admin() then raise exception 'interdit'; end if;
  return json_build_object(
    'defaut', (select plans_par_mois from relance.parametres where id),
    'clients', coalesce((
      select json_agg(x order by x.plans_mois desc, x.inscrit_le desc) from (
        select e.id, e.nom, u.email, u.created_at as inscrit_le,
               coalesce(iu.plans, 0) as plans_mois,
               l.plans_par_mois as limite,
               (select count(*) from relance.devis d where d.entreprise_id = e.id) as devis
        from relance.entreprises e
        join auth.users u on u.id = e.id
        left join relance.ia_usage iu on iu.entreprise_id = e.id and iu.mois = to_char(now(), 'YYYY-MM')
        left join relance.ia_limites l on l.entreprise_id = e.id
      ) x
    ), '[]'::json)
  );
end $$;
revoke all on function relance.admin_vue() from public, anon;
grant execute on function relance.admin_vue() to authenticated;

create or replace function relance.admin_limite_defaut(p_limite int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not relance.suis_admin() then raise exception 'interdit'; end if;
  if p_limite is null or p_limite < 0 or p_limite > 100000 then raise exception 'limite_invalide'; end if;
  update relance.parametres set plans_par_mois = p_limite where id;
end $$;
revoke all on function relance.admin_limite_defaut(int) from public, anon;
grant execute on function relance.admin_limite_defaut(int) to authenticated;

-- p_limite vide = le client revient à la limite par défaut
create or replace function relance.admin_limite_client(p_entreprise uuid, p_limite int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not relance.suis_admin() then raise exception 'interdit'; end if;
  if p_limite is null then
    delete from relance.ia_limites where entreprise_id = p_entreprise;
  elsif p_limite < 0 or p_limite > 100000 then
    raise exception 'limite_invalide';
  else
    insert into relance.ia_limites (entreprise_id, plans_par_mois) values (p_entreprise, p_limite)
    on conflict (entreprise_id) do update set plans_par_mois = excluded.plans_par_mois;
  end if;
end $$;
revoke all on function relance.admin_limite_client(uuid, int) from public, anon;
grant execute on function relance.admin_limite_client(uuid, int) to authenticated;

-- Ceinture et bretelles : le premier script donne des droits larges sur tout le schéma quand on le
-- rejoue ; ces tables-là ne s'écrivent que par les fonctions ci-dessus (ou par le serveur).
revoke insert, update, delete on relance.parametres, relance.ia_limites, relance.ia_usage from authenticated;
