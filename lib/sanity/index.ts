import { unstable_cache } from "next/cache";
import {
  createSanityCachedAccessors,
  type CacheFunction,
  type SanityFetch,
} from "./cache";
import { isSanityConfigured, sanityClient } from "./client";
import type { Page, Post } from "./types";

const sanityFetch: SanityFetch = (query, params) =>
  sanityClient.fetch(query, params);

const cached = createSanityCachedAccessors(
  sanityFetch,
  unstable_cache as CacheFunction,
);

/**
 * Configuration checks stay outside the persistent cache. Otherwise a build
 * without Sanity environment variables could cache fallback values.
 */
export async function getPage(slug: string): Promise<Page | undefined> {
  if (!isSanityConfigured) {
    console.log(`Skipping getPage for '${slug}' - Sanity not configured`);
    return undefined;
  }

  return cached.getPage(slug);
}

export async function getPages(): Promise<Page[]> {
  if (!isSanityConfigured) {
    console.log("Skipping getPages - Sanity not configured");
    return [];
  }

  return cached.getPages();
}

export async function getPost(slug: string): Promise<Post | undefined> {
  if (!isSanityConfigured) {
    console.log(`Skipping getPost for '${slug}' - Sanity not configured`);
    return undefined;
  }

  return cached.getPost(slug);
}

export async function getPosts(): Promise<Post[]> {
  if (!isSanityConfigured) {
    console.log("Skipping getPosts - Sanity not configured");
    return [];
  }

  return cached.getPosts();
}
