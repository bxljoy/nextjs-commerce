import { pageQuery, pagesQuery, postQuery, postsQuery } from "./queries.ts";
import type { Page, Post } from "./types.ts";
import { SANITY_CACHE_TAGS } from "./webhook.ts";

export const SANITY_REVALIDATE_SECONDS = 3600;

type SanityCacheConfiguration = {
  projectId: string;
  dataset: string;
  apiVersion: string;
  perspective: string;
  useCdn: boolean;
};

type CacheOptions = {
  revalidate: number;
  tags: string[];
};

type AsyncFunction = (...args: never[]) => Promise<unknown>;

export type CacheFunction = <T extends AsyncFunction>(
  callback: T,
  keyParts: string[],
  options: CacheOptions,
) => T;

export type SanityFetch = <T>(
  query: string,
  params?: Record<string, unknown>,
) => Promise<T>;

export function createSanityCacheNamespace({
  projectId,
  dataset,
  apiVersion,
  perspective,
  useCdn,
}: SanityCacheConfiguration): string {
  return `project=${projectId};dataset=${dataset};apiVersion=${apiVersion};perspective=${perspective};cdn=${useCdn}`;
}

/**
 * `unstable_cache` includes function arguments in its cache key. Keeping slugs
 * as callback arguments prevents detail entries from colliding. Query text and
 * client configuration are key parts because the callbacks close over them.
 *
 * Source: https://nextjs.org/docs/15/app/api-reference/functions/unstable_cache
 */
export function createSanityCachedAccessors(
  fetch: SanityFetch,
  cache: CacheFunction,
  namespace: string,
) {
  const pageOptions = {
    revalidate: SANITY_REVALIDATE_SECONDS,
    tags: [SANITY_CACHE_TAGS.pages],
  };
  const postOptions = {
    revalidate: SANITY_REVALIDATE_SECONDS,
    tags: [SANITY_CACHE_TAGS.posts],
  };

  return {
    getPage: cache(
      async (slug: string): Promise<Page | undefined> =>
        (await fetch<Page | null>(pageQuery, { slug })) ?? undefined,
      ["sanity-page", namespace, pageQuery],
      pageOptions,
    ),
    getPages: cache(
      async (): Promise<Page[]> => (await fetch<Page[]>(pagesQuery)) ?? [],
      ["sanity-pages", namespace, pagesQuery],
      pageOptions,
    ),
    getPost: cache(
      async (slug: string): Promise<Post | undefined> =>
        (await fetch<Post | null>(postQuery, { slug })) ?? undefined,
      ["sanity-post", namespace, postQuery],
      postOptions,
    ),
    getPosts: cache(
      async (): Promise<Post[]> => (await fetch<Post[]>(postsQuery)) ?? [],
      ["sanity-posts", namespace, postsQuery],
      postOptions,
    ),
  };
}
