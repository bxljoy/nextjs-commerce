import assert from "node:assert/strict";
import test from "node:test";
import * as cacheModule from "./cache.ts";
import { pageQuery, postsQuery } from "./queries.ts";

type CacheOptions = { revalidate: number; tags: string[] };
type AsyncFunction = (...args: never[]) => Promise<unknown>;
type CacheFunction = <T extends AsyncFunction>(
  callback: T,
  keyParts: string[],
  options: CacheOptions,
) => T;
type SanityFetch = <T>(
  query: string,
  params?: Record<string, unknown>,
) => Promise<T>;
type CachedAccessors = {
  getPage: (slug: string) => Promise<unknown>;
  getPages: () => Promise<unknown>;
  getPost: (slug: string) => Promise<unknown>;
  getPosts: () => Promise<unknown>;
};
type CreateSanityCachedAccessors = (
  fetch: SanityFetch,
  cache: CacheFunction,
) => CachedAccessors;

const createSanityCachedAccessors = (
  cacheModule as unknown as {
    createSanityCachedAccessors?: CreateSanityCachedAccessors;
  }
).createSanityCachedAccessors;

test("creates argument-aware cache boundaries with finite type tags", async () => {
  assert.equal(typeof createSanityCachedAccessors, "function");

  const boundaries: { keyParts: string[]; options: CacheOptions }[] = [];
  const fetches: {
    query: string;
    params?: Record<string, unknown>;
  }[] = [];
  const cache: CacheFunction = (callback, keyParts, options) => {
    boundaries.push({ keyParts, options });
    return callback;
  };
  const fetch: SanityFetch = async <T>(
    query: string,
    params?: Record<string, unknown>,
  ) => {
    fetches.push({ query, params });
    return null as T;
  };

  const accessors = createSanityCachedAccessors!(fetch, cache);
  await accessors.getPage("about");
  await accessors.getPage("contact");
  await accessors.getPosts();

  assert.deepEqual(fetches, [
    { query: pageQuery, params: { slug: "about" } },
    { query: pageQuery, params: { slug: "contact" } },
    { query: postsQuery, params: undefined },
  ]);
  assert.deepEqual(boundaries, [
    {
      keyParts: ["sanity-page"],
      options: { revalidate: 3600, tags: ["pages"] },
    },
    {
      keyParts: ["sanity-pages"],
      options: { revalidate: 3600, tags: ["pages"] },
    },
    {
      keyParts: ["sanity-post"],
      options: { revalidate: 3600, tags: ["posts"] },
    },
    {
      keyParts: ["sanity-posts"],
      options: { revalidate: 3600, tags: ["posts"] },
    },
  ]);
});
