-- Enrichment fields for a lead: the profile image, and public contact details.
--
-- `avatar_url` is free. The LinkedIn search-result card already carries an
-- <img>, so extract.ts reads it during the ordinary scan. No profile visit.
--
-- `email` and `phone` are NOT on the search card. They exist only behind
-- "Contact info" on an individual profile, which is why they require a
-- background-tab visit to /in/<slug>/overlay/contact-info/. Only leads that
-- cleared icps.min_score are ever enriched — sub-threshold leads are not even
-- stored (see score-lead's discard branch).
--
-- `enriched_at` is the load-bearing column, and the reason this is four columns
-- rather than three. Without it, a null `email` is permanently ambiguous
-- between:
--     "we opened this profile and it publishes no email"   and
--     "we have never opened this profile".
-- The lead card must be able to say "No public contact info" truthfully rather
-- than "unknown". This is the same distinction the `country` column learned the
-- hard way: every lead scored before that migration was left null forever with
-- no way to tell why, because score-lead's dedup branch returns before the LLM
-- is ever called and could not backfill them.
--
-- Unlike `country`, these ARE backfillable: linkedin_url is stored, and
-- enrichment is a profile visit rather than a re-score. No backfill job ships
-- here. Every pre-existing lead has enriched_at = null and renders as "Not
-- looked up yet", which is true.
alter table public.leads
  add column avatar_url  text,
  add column email       text,
  add column phone       text,
  add column enriched_at timestamptz;

-- The panel's "has contact info" glyphs (✉ / ☎) are rendered per row from
-- email/phone being non-null, so no index is needed for them. This index serves
-- the enrichment queue itself: "leads of mine that have a profile URL and have
-- never been looked up". Partial, because the enriched rows are exactly the ones
-- it must never return, and they will eventually be the majority.
create index leads_user_unenriched_idx
  on public.leads (user_id)
  where enriched_at is null and linkedin_url is not null;
