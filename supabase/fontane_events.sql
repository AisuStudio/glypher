-- Fontane.Studio mini analytics — one append-only events table.
-- Run this once in Fontane.Studio's own Supabase project (SQL Editor).

create table if not exists fontane_events (
  id bigint generated always as identity primary key,
  type text not null check (type in ('pageview', 'duration', 'export')),
  -- A same-day, non-reversible sha256 fingerprint of IP+User-Agent (see
  -- api/track/route.ts's dailyVisitorFingerprint), NOT a persistent id — the
  -- app never stores or reads anything on the visitor's own device, so this
  -- table is the only place "uniqueness" is approximated, and only within a
  -- single day.
  visitor_id text,
  seconds integer,
  format text,
  -- Referring hostname only (e.g. "google.com"), not the full referrer URL —
  -- null means direct traffic (typed URL, bookmark, or same-origin nav).
  referrer text,
  created_at timestamptz not null default now()
);

alter table fontane_events add column if not exists referrer text;

-- Coarse, GDPR-safe additions (2026-07-23): each is a single aggregate
-- category, never itself identifying, and none of them are stored anywhere
-- other than on the pageview row they arrived with — see api/track/route.ts.
-- - country: 2-letter code from Vercel's edge geolocation() — the request's
--   IP is used to derive this at the edge and never reaches our own code or
--   storage at all (contrast with visitor_id above, which does see the raw
--   IP for one hash operation before discarding it).
-- - device: "mobile" | "tablet" | "desktop", parsed from User-Agent
--   server-side — the full UA string itself is never stored.
-- - language: 2-letter code from the browser's own navigator.language,
--   client-supplied (nothing else on this table is) since only the browser
--   knows it — same "aggregate category only" reasoning applies.
-- - page: which surface the pageview happened on ("editor" | "marketplace" |
--   "marketplace-listing") — lets the marketplace browse→download ratio be
--   computed without adding any new identifying data.
alter table fontane_events add column if not exists country text;
alter table fontane_events add column if not exists device text;
alter table fontane_events add column if not exists language text;
alter table fontane_events add column if not exists page text;

-- "tool_use" (2026-07-23): one event per completed tool action (a finished
-- stroke, a placed Vector anchor, a Move/Rotate/Scale/Nudge/Assign that
-- actually changed something) — which tool, not what it did. Reuses the
-- existing `format` column (unused for this type) rather than adding a
-- dedicated column, same aggregate-count-only shape as exports-by-format.
alter table fontane_events drop constraint if exists fontane_events_type_check;
alter table fontane_events add constraint fontane_events_type_check
  check (type in ('pageview', 'duration', 'export', 'tool_use'));

-- RLS enabled with NO policies = deny-all for the anon/authenticated roles.
-- The app only ever reads/writes via the service_role key (server-side
-- only, in Vercel's env vars), which bypasses RLS entirely — so nothing
-- else needs a policy added here.
alter table fontane_events enable row level security;

create index if not exists fontane_events_type_idx on fontane_events (type);

-- service_role bypasses RLS but NOT plain SQL privileges — a table created
-- outside Supabase's dashboard SQL editor (e.g. via a direct psql/pg
-- connection, as this one was) doesn't automatically pick up the default
-- grants Supabase normally applies. Without this, every insert/select from
-- the app fails with "permission denied for table fontane_events".
grant select, insert, delete on public.fontane_events to service_role;
grant usage, select on sequence fontane_events_id_seq to service_role;
