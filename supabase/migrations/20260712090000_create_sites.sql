-- Multi-site, phase 1. A user may sell more than one thing, and each thing has
-- its own ideal customer, its own leads, and its own extension key.
--
-- Nothing user-visible changes here: every existing user ends up with exactly
-- one site, and a device_token that used to resolve to a user now resolves to
-- that user's only site. Extension builds already in the wild keep working —
-- unpacked extensions never auto-update, so that is not optional.

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  website_url text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Child tables carry BOTH site_id and user_id: site_id scopes, user_id
  -- authorizes. RLS stays `auth.uid() = user_id` with no join. This composite
  -- key is what the children point at, so a row whose site belongs to someone
  -- else is not representable rather than merely forbidden.
  unique (id, user_id)
);

-- Per-user, not global: two users may both track stripe.com.
create unique index sites_user_url_idx
  on public.sites (user_id, lower(website_url));

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

alter table public.sites enable row level security;

create policy "Users manage their own sites"
  on public.sites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.sites to authenticated;

-- ---------------------------------------------------------------------------
-- Columns first, nullable, so the backfill has somewhere to land.
-- ---------------------------------------------------------------------------

alter table public.icps add column site_id uuid;
alter table public.leads add column site_id uuid;
alter table public.folders add column site_id uuid;
alter table public.extension_pairings add column site_id uuid;

-- ---------------------------------------------------------------------------
-- Backfill. Idempotent: re-running inserts no duplicate sites and re-stamps
-- the same ids.
-- ---------------------------------------------------------------------------

-- One site per existing ICP. The name is the bare hostname — "outpulse.app",
-- not "https://outpulse.app/" — because it becomes a switcher label.
insert into public.sites (user_id, name, website_url)
select
  i.user_id,
  coalesce(
    nullif(
      regexp_replace(
        regexp_replace(i.website_url, '^https?://(www\.)?', '', 'i'),
        '[/?#].*$', ''
      ),
      ''
    ),
    'My site'
  ),
  i.website_url
from public.icps i
on conflict (user_id, lower(website_url)) do nothing;

update public.icps i
set site_id = s.id
from public.sites s
where s.user_id = i.user_id
  and lower(s.website_url) = lower(i.website_url)
  and i.site_id is null;

-- Everything else this user owns belongs to that same, only, site.
update public.leads l
set site_id = i.site_id
from public.icps i
where i.user_id = l.user_id and l.site_id is null;

update public.folders f
set site_id = i.site_id
from public.icps i
where i.user_id = f.user_id and f.site_id is null;

update public.extension_pairings p
set site_id = i.site_id
from public.icps i
where i.user_id = p.user_id and p.site_id is null;

-- A user can pair the extension, or create a folder from the panel, before they
-- ever finish onboarding — those users have no icps row and so no site above.
-- Give them a placeholder rather than deleting their rows or failing the NOT
-- NULL below. Onboarding adopts a site whose website_url is '' instead of
-- inserting a second one.
insert into public.sites (user_id, name, website_url)
select distinct user_id, 'Untitled site', ''
from (
  select user_id from public.leads             where site_id is null
  union select user_id from public.folders     where site_id is null
  union select user_id from public.extension_pairings where site_id is null
) orphans
on conflict (user_id, lower(website_url)) do nothing;

update public.leads l
set site_id = s.id
from public.sites s
where s.user_id = l.user_id and s.website_url = '' and l.site_id is null;

update public.folders f
set site_id = s.id
from public.sites s
where s.user_id = f.user_id and s.website_url = '' and f.site_id is null;

update public.extension_pairings p
set site_id = s.id
from public.sites s
where s.user_id = p.user_id and s.website_url = '' and p.site_id is null;

-- ---------------------------------------------------------------------------
-- Assert the backfill actually covered everything before locking it in. A
-- silent partial backfill would surface much later as leads nobody can see.
-- ---------------------------------------------------------------------------

do $$
declare
  stragglers int;
begin
  select
    (select count(*) from public.icps              where site_id is null)
  + (select count(*) from public.leads             where site_id is null)
  + (select count(*) from public.folders           where site_id is null)
  + (select count(*) from public.extension_pairings where site_id is null)
  into stragglers;

  if stragglers > 0 then
    raise exception 'sites backfill left % rows without a site_id', stragglers;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Lock it in.
-- ---------------------------------------------------------------------------

alter table public.icps              alter column site_id set not null;
alter table public.leads             alter column site_id set not null;
alter table public.folders           alter column site_id set not null;
alter table public.extension_pairings alter column site_id set not null;

alter table public.icps
  add constraint icps_site_fk
  foreign key (site_id, user_id) references public.sites (id, user_id)
  on delete cascade;

alter table public.leads
  add constraint leads_site_fk
  foreign key (site_id, user_id) references public.sites (id, user_id)
  on delete cascade;

alter table public.folders
  add constraint folders_site_fk
  foreign key (site_id, user_id) references public.sites (id, user_id)
  on delete cascade;

alter table public.extension_pairings
  add constraint extension_pairings_site_fk
  foreign key (site_id, user_id) references public.sites (id, user_id)
  on delete cascade;

-- One ICP per site, replacing one ICP per user. This is the constraint that
-- made a second website impossible.
alter table public.icps drop constraint icps_user_id_key;
alter table public.icps add constraint icps_site_id_key unique (site_id);

-- `Warm` may exist once per site now, not once per user.
drop index public.folders_user_name_idx;
create unique index folders_site_name_idx on public.folders (site_id, lower(name));

-- The inbox reads by site, and score-lead looks up the ICP by site.
create index leads_site_created_idx on public.leads (site_id, created_at desc);
create index leads_site_score_idx   on public.leads (site_id, match_score desc);
create index leads_site_folder_idx  on public.leads (site_id, folder_id);
create index folders_site_idx       on public.folders (site_id);
create index extension_pairings_site_idx on public.extension_pairings (site_id);

-- The inbox subscribes filtered on site_id now, and DELETE payloads carry only
-- the replica identity. leads and folders are already `replica identity full`
-- (migration 20260710110000); sites needs no realtime.

-- ---------------------------------------------------------------------------
-- folders_with_counts now aggregates a site's folders, not a user's. The old
-- signature is (uuid) and so is the new one, and CREATE OR REPLACE cannot
-- rename an input parameter — it has to be dropped first.
--
-- `security invoker` still, for the reason the original migration gives: a
-- `security definer` function taking an id would let any authenticated caller
-- pass someone else's and read their folder names.
-- ---------------------------------------------------------------------------

drop function public.folders_with_counts(uuid);

create function public.folders_with_counts(p_site_id uuid)
returns table (id uuid, name text, lead_count bigint)
language sql
stable
security invoker
as $$
  select f.id, f.name, count(l.id) as lead_count
  from public.folders f
  left join public.leads l
    on l.folder_id = f.id and l.site_id = f.site_id
  where f.site_id = p_site_id
  group by f.id, f.name
  order by lower(f.name);
$$;

revoke all on function public.folders_with_counts(uuid) from public;
revoke all on function public.folders_with_counts(uuid) from anon;
revoke all on function public.folders_with_counts(uuid) from authenticated;
grant execute on function public.folders_with_counts(uuid) to service_role;
