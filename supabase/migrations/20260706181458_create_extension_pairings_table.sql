create table public.extension_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  pairing_code text unique not null,
  device_token text unique,
  expires_at timestamptz not null,
  paired_at timestamptz,
  created_at timestamptz default now()
);

create index extension_pairings_user_idx
  on public.extension_pairings (user_id, created_at desc);

alter table public.extension_pairings enable row level security;

create policy "Users can view their own pairings"
  on public.extension_pairings for select
  using (auth.uid() = user_id);

create policy "Users can revoke their own pairings"
  on public.extension_pairings for delete
  using (auth.uid() = user_id);
