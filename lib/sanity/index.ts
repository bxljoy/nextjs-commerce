import { isSanityConfigured } from "./client";
import { sanityFetch } from "./live";
import { pageQuery, pagesQuery, postQuery, postsQuery } from "./queries";
import type { Page, Post } from "./types";

/**
 * `sanityFetch` calls `cacheTag`/`cacheLife` internally but does not open the
 * cache boundary itself, so each accessor supplies its own `"use cache"`. The
 * tags it attaches are Sanity's per-document `syncTags`; `<SanityLive />` in the
 * root layout expires them when content changes.
 */
export async function getPage(slug: string): Promise<Page | undefined> {
  "use cache";

  if (!isSanityConfigured) {
    console.log(`Skipping getPage for '${slug}' - Sanity not configured`);
    return undefined;
  }

  const { data } = await sanityFetch({ query: pageQuery, params: { slug } });
  return (data as Page | null) ?? undefined;
}

export async function getPages(): Promise<Page[]> {
  "use cache";

  if (!isSanityConfigured) {
    console.log("Skipping getPages - Sanity not configured");
    return [];
  }

  const { data } = await sanityFetch({ query: pagesQuery });
  return (data as Page[]) ?? [];
}

export async function getPost(slug: string): Promise<Post | undefined> {
  "use cache";

  if (!isSanityConfigured) {
    console.log(`Skipping getPost for '${slug}' - Sanity not configured`);
    return undefined;
  }

  const { data } = await sanityFetch({ query: postQuery, params: { slug } });
  return (data as Post | null) ?? undefined;
}

export async function getPosts(): Promise<Post[]> {
  "use cache";

  if (!isSanityConfigured) {
    console.log("Skipping getPosts - Sanity not configured");
    return [];
  }

  const { data } = await sanityFetch({ query: postsQuery });
  return (data as Post[]) ?? [];
}
