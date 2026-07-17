// Minimal analytics: no client-side storage at all (no cookie, no
// localStorage) — nothing is written to the visitor's device, so this never
// triggers ePrivacy/GDPR's consent requirement for storing/reading
// information on a user's terminal equipment. "Unique visitors" is instead
// approximated server-side (see api/track/route.ts) from a daily-rotating
// hash of IP+User-Agent that's never itself stored — an accepted
// less-than-perfect count (the same person across two days counts twice) in
// exchange for not tracking anyone. Session-duration and export-format
// events carry no identifier at all. Every send is fire-and-forget via
// sendBeacon (falls back to fetch with keepalive where unavailable) so it
// never blocks or breaks the drawing UI, and every failure is swallowed —
// analytics must never be able to throw into the caller.

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
  send({ type: "pageview", referrer: getReferrerHost() });
}

export function trackDuration(seconds: number) {
  if (seconds < 1) return;
  send({ type: "duration", seconds: Math.round(seconds) });
}

export function trackExport(format: string) {
  send({ type: "export", format });
}
