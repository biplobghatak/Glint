create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Case-insensitive and per-user: `Clients` and `clients` collide. The violation
-- surfaces as Postgres 23505, which the callers map to a friendly 409 rather
-- than a 500 or a silent no-op.
create unique index folders_user_name_idx on public.folders (user_id, lower(name));

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

-- `on delete set null` is the design: deleting a folder UNFILES its leads,
-- it never deletes them.
alter table public.leads
  add column folder_id uuid references public.folders(id) on delete set null;
create index leads_user_folder_idx on public.leads (user_id, folder_id);

alter table public.folders enable row level security;

create policy "Users manage their own folders"
  on public.folders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RLS decides which rows; GRANTs decide whether the role may touch the table
-- at all. Without this every query fails with "permission denied for table"
-- regardless of the policy above. See migration 20260708140000.
-- leads already has `update`, which covers writing folder_id.
grant select, insert, update, delete on public.folders to authenticated;

alter publication supabase_realtime add table public.folders;

-- Realtime sends only the primary key in a DELETE payload's `old` record under
-- the default replica identity. A subscription filtered on `user_id` therefore
-- never matches a DELETE, and RLS cannot authorize one either — the event is
-- dropped. The web rail must see a folder disappear, and a lead unfiled by
-- `on delete set null` must reach an open tab, so both tables need the full
-- pre-image.
alter table public.folders replica identity full;
alter table public.leads replica identity full;
