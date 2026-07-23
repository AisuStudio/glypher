-- Fontane.Studio cloud projects — lets a saved FFF project (the same JSON
-- ProjectFile shape as src/lib/projectFile.ts, glyphs+strokes+metrics+
-- settings) be stored server-side instead of only as a local file download,
-- so it can be reopened from another device. Run this once in
-- Fontane.Studio's own Supabase project (SQL Editor), same project as the
-- other fontane_*.sql files.
--
-- No user_id/RLS-policy-per-user here on purpose: there are no real accounts
-- (see FONTANE_BETA_CODE in api/projects/*) — a single shared secret code,
-- checked server-side in the route handlers, gates read/write to the whole
-- table. Anyone with the code sees the same shared project list, which is
-- exactly the point (syncing one person's own devices), not a limitation.

create table if not exists fontane_projects (
  id bigint generated always as identity primary key,
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS enabled with NO policies = deny-all for anon/authenticated. The app
-- only ever reads/writes via the service_role key (server-side only, in
-- api/projects/*), which bypasses RLS entirely — same pattern as
-- fontane_events/fontane_fonts/fontane_provenance_events.
alter table fontane_projects enable row level security;

create index if not exists fontane_projects_updated_idx on fontane_projects (updated_at desc);

grant select, insert, update, delete on public.fontane_projects to service_role;
grant usage, select on sequence fontane_projects_id_seq to service_role;
