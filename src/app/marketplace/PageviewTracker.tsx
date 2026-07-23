"use client";

import { useEffect } from "react";
import { trackPageview } from "@/lib/analytics";

// Marketplace pages are Server Components (no client JS otherwise), so
// pageview tracking needs this tiny mount-effect wrapper — reuses the exact
// same trackPageview() the main editor page already fires, so marketplace
// visits land in the same aggregate pageview count with the same
// production-only gating, IP exclusion, and ?notrack opt-out.
export default function PageviewTracker({ page = "marketplace" }: { page?: string }) {
  useEffect(() => {
    trackPageview(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
