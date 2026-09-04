import { createClient, type SanityClient } from "@sanity/client";

// Pinned deliberately: Sanity's API is date-versioned, and an unpinned client
// silently follows the latest schema behaviour. Bump only with a query review.
export const SANITY_API_VERSION = "2024-01-01";

const projectId = process.env.SANITY_PROJECT_ID;
const dataset = process.env.SANITY_DATASET;

/** Mirrors `lib/shopify`'s `endpoint` guard so routes degrade instead of throwing. */
export const isSanityConfigured = Boolean(projectId && dataset);

export const sanityClient: SanityClient | null = isSanityConfigured
  ? createClient({
      projectId: projectId!,
      dataset: dataset!,
      apiVersion: SANITY_API_VERSION,
      // The `use cache` layer in ./index.ts already absorbs repeat traffic, so
      // the CDN would only add a second staleness window on revalidation.
      useCdn: false,
      perspective: "published",
    })
  : null;
