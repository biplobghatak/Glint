-- Geography for leads, and the ICP's target geography.
--
-- `location` is the raw subline off the LinkedIn search-result card
-- ("Berlin, Germany", "Greater Seattle Area"). It is best-effort: LinkedIn's
-- DOM is hostile and the extractor fails soft, so null is a normal value, not
-- an error.
--
-- `country` is ISO-3166 alpha-2, derived server-side by the LLM in score-lead
-- rather than by a lookup table shipped in the content script. "Greater Seattle
-- Area" is not a country name, and no table we could ship would map it.
--
-- CAUTION for whoever builds the country filter: every lead scored BEFORE this
-- migration has country = null, permanently. score-lead's dedup branch returns
-- before it ever calls the LLM, so ordinary browsing will never backfill them,
-- and `location` is null for them too, so no offline backfill is possible
-- either. "Unknown" (country is null) must therefore be a first-class,
-- selectable, ON-BY-DEFAULT filter chip. A country filter that silently drops
-- every pre-existing lead reads as data loss.
alter table public.leads add column location text;
alter table public.leads add column country text;

-- Supports the panel's country filter, which is always scoped to one user.
create index leads_user_country_idx on public.leads (user_id, country);

-- Empty array = "no geographic preference", which the suggestion query reads as
-- "match every country" rather than "match none". not null keeps that check a
-- cardinality test instead of a null test at every call site.
alter table public.icps
  add column target_countries text[] not null default '{}';
