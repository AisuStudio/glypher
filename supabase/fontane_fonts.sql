-- Fontane.Studio marketplace — published fonts metadata.
-- Run this once in CNSL's Supabase project (SQL Editor), same project as
-- fontane_events.sql. Own table, own RLS — no relation to analytics.
--
-- Also requires a Storage bucket named "fonts", created manually via the
-- Supabase dashboard (Storage > New bucket), marked PUBLIC so downloads
-- work as plain unauthenticated URLs without an anon key. Uploads only
-- ever happen server-side via the service_role key (api/fonts/publish).

create table if not exists fontane_fonts (
  id bigint generated always as identity primary key,
  slug text not null unique,
  display_name text not null,
  glyph_count integer not null,
  file_size integer not null,
  download_count integer not null default 0,
  -- Publishing requires checking the "100% unrestricted use" box in the UI;
  -- this timestamp records that consent. There is no per-font license
  -- variant — this is the only option, so the column is really just a
  -- provenance record, not a live-checked constraint.
  license_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Both optional — the publisher can leave either blank. author_url is
  -- freeform text (light normalization, e.g. adding "https://", happens in
  -- api/fonts/publish, not enforced here).
  author_name text,
  author_url text,
  -- Which draft/browser's recorded provenance justified this publish (see
  -- fontane_provenance.sql) — null for fonts published before the
  -- provenance gate existed (grandfathered, not retroactively checked).
  draft_id text,
  author_id text
);

-- Safe to re-run even if the table above already exists from an earlier
-- version of this file (same pattern as fontane_events.sql's referrer column).
alter table fontane_fonts add column if not exists author_name text;
alter table fontane_fonts add column if not exists author_url text;
alter table fontane_fonts add column if not exists draft_id text;
alter table fontane_fonts add column if not exists author_id text;

-- RLS enabled with NO policies = deny-all for anon/authenticated. The app
-- has no anon key configured at all — every read/write goes through
-- service_role server-side (browse/overview pages, publish/download/search
-- API routes), which bypasses RLS entirely.
alter table fontane_fonts enable row level security;

create index if not exists fontane_fonts_slug_idx on fontane_fonts (slug);

-- Same explicit-grant requirement as fontane_events.sql (table created via
-- direct psql, not the dashboard SQL editor, so default grants don't apply).
grant select, insert, update on public.fontane_fonts to service_role;
grant usage, select on sequence fontane_fonts_id_seq to service_role;
