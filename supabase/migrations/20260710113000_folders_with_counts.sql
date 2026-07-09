-- lead_count for the panel's folder <select>, aggregated in Postgres.
--
-- The alternative is fetching every lead's folder_id into the Edge Function and
-- tallying in JS, which reintroduces exactly the unbounded fetch that list-leads
-- exists to avoid. A left join keeps empty folders in the result with a count
-- of 0 rather than dropping them.
--
-- `security invoker` on purpose. Edge Functions call this as service_role, which
-- bypasses RLS; nothing else may call it at all. A `security definer` function
-- taking p_user_id would let any authenticated caller pass someone else's id and
-- read their folder names.
create function public.folders_with_counts(p_user_id uuid)
returns table (id uuid, name text, lead_count bigint)
language sql
stable
security invoker
as $$
  select f.id, f.name, count(l.id) as lead_count
  from public.folders f
  left join public.leads l
    on l.folder_id = f.id and l.user_id = f.user_id
  where f.user_id = p_user_id
  group by f.id, f.name
  order by lower(f.name);
$$;

revoke all on function public.folders_with_counts(uuid) from public;
revoke all on function public.folders_with_counts(uuid) from anon;
revoke all on function public.folders_with_counts(uuid) from authenticated;
grant execute on function public.folders_with_counts(uuid) to service_role;
