// The shared betacode that unlocks cloud project save/load (see
// api/projects/*, which check it server-side against FONTANE_BETA_CODE — a
// value passed here is never itself proof of anything, just a convenience
// so the user doesn't retype it on every save on the same device).
const STORAGE_KEY = "fontane.cloudCode.v1";

export function getStoredCode(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredCode(code: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, code);
}

export function clearStoredCode() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
