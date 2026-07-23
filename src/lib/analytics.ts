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

// An explicit, manual opt-out — visit fontane.studio/?notrack and nothing
// for that page load ever gets sent. Complements the IP allowlist in
// api/track/route.ts (automatic, but tied to a specific IP that can change);
// this works from anywhere, no IP to know or maintain. Checked once per
// page load rather than persisted anywhere, matching the "nothing written to
// the visitor's own device" rule above — the param has to be present on
// every visit you want excluded, but that's the same one-time cost as
// bookmarking the URL.
function isTrackingSuppressed(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("notrack");
}

function send(payload: Record<string, unknown>) {
  if (typeof window === "undefined" || isTrackingSuppressed()) return;
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

// "editor" (default, the main tool) | "marketplace" | "marketplace-listing"
// — lets the dashboard compute a marketplace browse→download ratio. Only
// ever a fixed category string, not a path/URL.
export function trackPageview(page: string = "editor") {
  // navigator.language is e.g. "de-DE" — only the 2-letter language part is
  // sent, same "coarse aggregate category, not the full raw value" rule
  // country/device follow server-side in api/track/route.ts.
  const language = typeof navigator !== "undefined" ? navigator.language?.slice(0, 2) || null : null;
  send({ type: "pageview", referrer: getReferrerHost(), page, language });
}

export function trackDuration(seconds: number) {
  if (seconds < 1) return;
  send({ type: "duration", seconds: Math.round(seconds) });
}

export function trackExport(format: string) {
  send({ type: "export", format });
}

// One ping per completed tool action (a finished stroke, a placed Vector
// anchor, a Move/Rotate/Scale/Nudge/Assign that actually changed something)
// — which tool, not what it did or on what content.
export function trackToolUse(tool: string) {
  send({ type: "tool_use", tool });
}
