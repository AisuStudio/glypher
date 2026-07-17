-- Fontane.Studio mini analytics — one append-only events table.
-- Run this once in CNSL's Supabase project (SQL Editor). Deliberately
-- separate from any CNSL table (own name, own RLS) — reuses the project,
-- not the data.

create table if not exists fontane_events (
  id bigint generated always as identity primary key,
  type text not null check (type in ('pageview', 'duration', 'export')),
  visitor_id text,
  seconds integer,
  format text,
  -- Referring hostname only (e.g. "google.com"), not the full referrer URL —
  -- null means direct traffic (typed URL, bookmark, or same-origin nav).
  referrer text,
  created_at timestamptz not null default now()
);

alter table fontane_events add column if not exists referrer text;

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
