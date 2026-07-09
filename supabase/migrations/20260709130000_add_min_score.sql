-- The score threshold below which a lead is not worth surfacing.
--
-- `match_score` is stored 0-100 (score-lead's JSON schema caps at 100, and its
-- prompt says "0-100, 100 = perfect fit"). Nothing divides by 10 anywhere, so a
-- literal "score > 7" threshold would hide only near-zero leads and appear to
-- do nothing. 70 is that intent expressed on the scale the data actually uses.
--
-- It lives on icps rather than a new user_settings table because icps.user_id
-- is already unique (one row per user), its RLS policies and table GRANTs
-- already exist, and "what counts as a good lead" is part of the ideal customer
-- profile by definition.
--
-- CAUTION for whoever wires this up: generate-icp writes this row. A
-- whole-object upsert there will reset min_score to 70 every time a user
-- re-runs onboarding. Enumerate columns explicitly.
alter table public.icps
  add column min_score int not null default 70
    check (min_score between 0 and 100);
