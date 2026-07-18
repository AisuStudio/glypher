-- Fontane.Studio marketplace — provenance events, the publish-gate's source
-- of truth. Run this once in CNSL's Supabase project (SQL Editor), same
-- project as fontane_events.sql / fontane_fonts.sql. Own table, own RLS.
--
-- One row per completed stroke drawn in the app (Free/Editor AND Grid),
-- server-stamped. A font is only publishable if a plausible spread of these
-- exists for its draft_id+author_id — see api/fonts/publish/route.ts. Only
-- small scalar aggregates are stored (no raw point/pressure arrays): cheap
-- per row regardless of how many points the original stroke had, and keeps
-- this well clear of anything resembling raw biometric/behavioral data.

create table if not exists fontane_provenance_events (
  id bigint generated always as identity primary key,
  -- Client-generated, localStorage-persisted, anonymous — NOT an account.
  -- Ties a sequence of events to "this browser's current project" and "this
  -- browser," nothing more. See src/lib/provenance.ts.
  draft_id text not null,
  author_id text not null,
  -- Correlates to the local stroke's own id — lets a retried batch send be
  -- deduped without needing a unique constraint (best-effort, not enforced).
  client_stroke_id text,
  context text, -- "free" | "grid" | "editor"
  tool text, -- "pen" | "brush"
  point_count integer,
  -- Client-reported wall-clock span of the stroke gesture itself
  -- (pointerdown→pointerup) — informational, NOT itself a trust signal
  -- (the client reports it). created_at below is the one field that can't
  -- be forged.
  duration_ms integer,
  avg_pressure real,
  pressure_variance real,
  bbox_w real,
  bbox_h real,
  -- Server-stamped, never client-supplied. The publish gate's core signal:
  -- a real spread of these over real wall-clock time is what a converted/
  -- imported font can't produce.
  created_at timestamptz not null default now()
);

alter table fontane_provenance_events enable row level security;

create index if not exists fontane_provenance_events_draft_idx on fontane_provenance_events (draft_id, author_id);
create index if not exists fontane_provenance_events_created_idx on fontane_provenance_events (created_at);

grant select, insert, delete on public.fontane_provenance_events to service_role;
grant usage, select on sequence fontane_provenance_events_id_seq to service_role;
