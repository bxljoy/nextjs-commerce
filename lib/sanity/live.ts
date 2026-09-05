import { defineLive } from "next-sanity/live";
import { sanityClient } from "./client";

/**
 * Live revalidation for published content.
 *
 * `sanityFetch` attaches Sanity's per-document `syncTags` via `cacheTag`, and
 * `<SanityLive />` expires them through a Server Action when the content
 * changes — so an edit in the Studio reaches open pages without a webhook.
 *
 * Both tokens are `false` on purpose. Tokens are only needed to read drafts,
 * which stay out of scope (see docs/intent/sanity-cms.md). Passing `false`
 * rather than omitting them also silences next-sanity's draft-preview warning.
 */
export const { SanityLive, sanityFetch } = defineLive({
  client: sanityClient,
  serverToken: false,
  browserToken: false,
});
