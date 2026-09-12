import { createClient, type SanityClient } from "@sanity/client";
import { createSanityCacheNamespace } from "./cache";

// Pinned deliberately: Sanity's API is date-versioned, and an unpinned client
// silently follows the latest schema behaviour. Bump only with a query review.
//
// Looking old is not a reason to bump it. Unlike SHOPIFY_API_VERSION in
// lib/constants.ts, Sanity versions do not expire — old ones keep working, and
// deprecation is announced via X-Sanity-Deprecated / X-Sanity-Warning response
// headers well before a version is removed (removal then returns 410, loudly).
// Bump when you need a GROQ feature added after this date, not on a calendar.
export const SANITY_API_VERSION = "2024-01-01";

const projectId = process.env.SANITY_PROJECT_ID;
const dataset = process.env.SANITY_DATASET;
const perspective = "published";
const useCdn = false;

/** Mirrors `lib/shopify`'s `endpoint` guard so routes degrade instead of throwing. */
export const isSanityConfigured = Boolean(projectId && dataset);

export const SANITY_CACHE_NAMESPACE = createSanityCacheNamespace({
  projectId: projectId || "placeholder",
  dataset: dataset || "production",
  apiVersion: SANITY_API_VERSION,
  perspective,
  useCdn,
});

/**
 * Always non-null so accessors can import one client without conditional
 * construction. When env vars are missing, the placeholder is never queried
 * because every accessor in ./index.ts returns early.
 */
export const sanityClient: SanityClient = createClient({
  projectId: projectId || "placeholder",
  dataset: dataset || "production",
  apiVersion: SANITY_API_VERSION,
  // Webhook invalidation promises fresh content on the next request. Bypass
  // the CDN so a newly expired Next cache cannot be repopulated by a briefly
  // stale CDN response while Sanity's edge cache catches up.
  useCdn,
  perspective,
});
