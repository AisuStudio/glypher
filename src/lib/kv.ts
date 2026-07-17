import { Redis } from "@upstash/redis";

// Redis.fromEnv() reads UPSTASH_REDIS_REST_URL/TOKEN (Vercel Marketplace Redis
// integration) with a fallback to the older KV_REST_API_URL/TOKEN names — it
// only warns (doesn't throw) if neither is set, so this stays safe to
// construct even before the integration is provisioned in Vercel. Every
// actual command call must still be wrapped in try/catch by its caller, since
// a request against missing/invalid credentials throws at call time.
export const redis = Redis.fromEnv();
