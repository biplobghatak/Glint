create table public.icps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique,
  website_url text not null,
  target_roles text[],
  company_types text[],
  pain_points text[],
  raw_summary text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.icps enable row level security;

create policy "Users can view their own ICP"
  on public.icps for select
  using (auth.uid() = user_id);

create policy "Users can insert their own ICP"
  on public.icps for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own ICP"
  on public.icps for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger icps_set_updated_at
  before update on public.icps
  for each row
  execute function public.set_updated_at();
