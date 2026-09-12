import { pageQuery, pagesQuery, postQuery, postsQuery } from "./queries.ts";
import type { Page, Post } from "./types.ts";
import { SANITY_CACHE_TAGS } from "./webhook.ts";

export const SANITY_REVALIDATE_SECONDS = 3600;

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

/**
 * `unstable_cache` includes function arguments in its cache key. Keeping slugs
 * as callback arguments prevents page and post detail entries from colliding.
 *
 * Source: https://nextjs.org/docs/15/app/api-reference/functions/unstable_cache
 */
export function createSanityCachedAccessors(
  fetch: SanityFetch,
  cache: CacheFunction,
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
      ["sanity-page"],
      pageOptions,
    ),
    getPages: cache(
      async (): Promise<Page[]> => (await fetch<Page[]>(pagesQuery)) ?? [],
      ["sanity-pages"],
      pageOptions,
    ),
    getPost: cache(
      async (slug: string): Promise<Post | undefined> =>
        (await fetch<Post | null>(postQuery, { slug })) ?? undefined,
      ["sanity-post"],
      postOptions,
    ),
    getPosts: cache(
      async (): Promise<Post[]> => (await fetch<Post[]>(postsQuery)) ?? [],
      ["sanity-posts"],
      postOptions,
    ),
  };
}
