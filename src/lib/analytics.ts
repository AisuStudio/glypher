// Minimal client-side analytics: an anonymous per-browser visitor id (not a
// real identity — clearing localStorage or switching devices/browsers just
// starts a new one, which is an accepted tradeoff for a "mini" hobby-tool
// counter, not a privacy-invasive tracking system), a session-duration
// beacon, and export-format events. Every send is fire-and-forget via
// sendBeacon (falls back to fetch with keepalive where unavailable) so it
// never blocks or breaks the drawing UI, and every failure is swallowed —
// analytics must never be able to throw into the caller.

const VISITOR_ID_KEY = "fontane.visitorId.v1";

function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

function send(payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/track", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    // analytics must never throw into the caller
  }
}

// Just the referring hostname (e.g. "google.com"), not the full referrer URL
// — enough to tell direct traffic (empty) from everything else, or later
// break down by source, without carrying over query strings/search terms
// that can leak into document.referrer.
function getReferrerHost(): string | null {
  if (!document.referrer) return null;
  try {
    const host = new URL(document.referrer).hostname;
    return host === window.location.hostname ? null : host;
  } catch {
    return null;
  }
}

export function trackPageview() {
  send({ type: "pageview", visitorId: getVisitorId(), referrer: getReferrerHost() });
}

export function trackDuration(seconds: number) {
  if (seconds < 1) return;
  send({ type: "duration", seconds: Math.round(seconds) });
}

export function trackExport(format: string) {
  send({ type: "export", format });
}
