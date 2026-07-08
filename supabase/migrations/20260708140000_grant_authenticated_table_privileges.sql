-- RLS policies control which rows a role can see; Postgres separately requires
-- base table-level GRANTs before the role can touch the table at all. These were
-- never issued, so every direct (non-service-role) client query against these
-- tables failed with "permission denied for table ..." regardless of RLS.
grant select, insert, update on public.icps to authenticated;
grant select, update on public.leads to authenticated;
grant select, delete on public.extension_pairings to authenticated;
