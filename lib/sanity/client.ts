import { createClient, type SanityClient } from "@sanity/client";

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

/** Mirrors `lib/shopify`'s `endpoint` guard so routes degrade instead of throwing. */
export const isSanityConfigured = Boolean(projectId && dataset);

/**
 * Always non-null: `defineLive` needs a real client at module scope. When the
 * env vars are missing the placeholder is never actually queried, because every
 * accessor in ./index.ts returns early on `isSanityConfigured`.
 */
export const sanityClient: SanityClient = createClient({
  projectId: projectId || "placeholder",
  dataset: dataset || "production",
  apiVersion: SANITY_API_VERSION,
  // On, unlike the pre-SanityLive setup. Invalidation is now driven by the
  // per-document `syncTags` that `sanityFetch` attaches, so the CDN's own
  // staleness window no longer competes with our cache lifetime.
  useCdn: true,
  perspective: "published",
});
