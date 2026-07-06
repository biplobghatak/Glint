create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text,
  company text,
  role text,
  linkedin_url text,
  post_context text,
  match_score int,
  match_reasons text[],
  status text not null default 'new'
    check (status in ('new', 'contacted', 'ignored')),
  source text not null default 'extension'
    check (source in ('extension', 'profile', 'post', 'search_result')),
  created_at timestamptz default now()
);

create index leads_user_created_idx
  on public.leads (user_id, created_at desc);
create index leads_user_score_idx
  on public.leads (user_id, match_score desc);

alter table public.leads enable row level security;

create policy "Users can view their own leads"
  on public.leads for select
  using (auth.uid() = user_id);

create policy "Users can insert their own leads"
  on public.leads for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own leads"
  on public.leads for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own leads"
  on public.leads for delete
  using (auth.uid() = user_id);
