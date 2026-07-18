import type { StrokePoint } from "@/lib/strokes";

// Client-generated, localStorage-persisted, anonymous identifiers — NOT an
// account system (none exists in this app). authorId is stable for this
// browser across every project; draftId is stable for the CURRENT project
// only and rolls to a fresh value on New File, mirroring how glyphs/strokes/
// metrics/settings already reset there. See the provenance plan for why:
// tying a spread of server-stamped drawing events to "this browser, this
// project" is the whole mechanism the publish gate checks.
//
// Unlike src/lib/analytics.ts, this module deliberately does NOT honor
// ?notrack — that flag is a privacy opt-out for telemetry no feature
// depends on; provenance is a functional gate publishing itself relies on,
// so silently no-op'ing it would just be a way to bypass the gate.
const AUTHOR_ID_KEY = "fontane.authorId.v1";
const DRAFT_ID_KEY = "fontane.draftId.v1";
const QUEUE_KEY = "fontane.provenanceQueue.v1";

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function getAuthorId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(AUTHOR_ID_KEY);
  if (!id) {
    id = newId();
    window.localStorage.setItem(AUTHOR_ID_KEY, id);
  }
  return id;
}

export function getDraftId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(DRAFT_ID_KEY);
  if (!id) {
    id = newId();
    window.localStorage.setItem(DRAFT_ID_KEY, id);
  }
  return id;
}

// Called from New File — a fresh project gets a fresh draft, so the
// provenance trail of whatever was just cleared can't be reused to publish
// unrelated later work.
export function rollDraftId(): string {
  const id = newId();
  if (typeof window !== "undefined") window.localStorage.setItem(DRAFT_ID_KEY, id);
  return id;
}

export type ProvenanceContext = "free" | "grid" | "editor";
export type ProvenanceTool = "pen" | "brush";

export type ProvenanceEvent = {
  draftId: string;
  authorId: string;
  clientStrokeId: string;
  context: ProvenanceContext;
  tool: ProvenanceTool;
  pointCount: number;
  durationMs: number;
  avgPressure: number;
  pressureVariance: number;
  bboxW: number;
  bboxH: number;
};

// Cheap aggregates computed once from a stroke's already-captured points —
// the "small but comprehensive" payload decided in the provenance plan
// (no raw point/pressure arrays leave the browser).
export function summarizeStroke(points: StrokePoint[], startedAt: number): Omit<ProvenanceEvent, "draftId" | "authorId" | "clientStrokeId" | "context" | "tool"> {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let pressureSum = 0;
  for (const [x, y, pressure] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    pressureSum += pressure;
  }
  const avgPressure = points.length ? pressureSum / points.length : 0;
  let varianceSum = 0;
  for (const [, , pressure] of points) varianceSum += (pressure - avgPressure) ** 2;
  const pressureVariance = points.length ? varianceSum / points.length : 0;
  return {
    pointCount: points.length,
    durationMs: Math.max(0, Date.now() - startedAt),
    avgPressure,
    pressureVariance,
    bboxW: Number.isFinite(maxX - minX) ? maxX - minX : 0,
    bboxH: Number.isFinite(maxY - minY) ? maxY - minY : 0,
  };
}

function loadQueue(): ProvenanceEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: ProvenanceEvent[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

const FLUSH_BATCH_SIZE = 10;

// Fire-and-forget beacon flush (same idiom as analytics.ts's send()) — used
// for the periodic/unload flush. Optimistically clears the queue before
// sending since sendBeacon gives no ack; losing an occasional batch is
// acceptable for a plausibility gate, not audit-grade record-keeping.
export function flushProvenanceQueue() {
  if (typeof window === "undefined") return;
  const queue = loadQueue();
  if (queue.length === 0) return;
  saveQueue([]);
  try {
    const body = JSON.stringify({ events: queue });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/provenance/events", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/provenance/events", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    // best-effort — never throw into the caller
  }
}

export function enqueueProvenanceEvent(event: ProvenanceEvent) {
  if (typeof window === "undefined") return;
  const queue = loadQueue();
  queue.push(event);
  saveQueue(queue);
  if (queue.length >= FLUSH_BATCH_SIZE) flushProvenanceQueue();
}

// Real fetch + await, used ONLY right before a publish attempt — unlike the
// beacon flush above, the publish flow needs to know the events actually
// landed server-side before asking the backend to check for them.
export async function flushProvenanceQueueAndWait(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const queue = loadQueue();
  if (queue.length === 0) return true;
  try {
    const res = await fetch("/api/provenance/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: queue }),
    });
    if (res.ok) {
      saveQueue([]);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
