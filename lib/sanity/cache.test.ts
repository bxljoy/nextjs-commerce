import assert from "node:assert/strict";
import test from "node:test";
import * as cacheModule from "./cache.ts";
import { pageQuery, pagesQuery, postQuery, postsQuery } from "./queries.ts";

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
  namespace: string,
) => CachedAccessors;
type CreateSanityCacheNamespace = (configuration: {
  projectId: string;
  dataset: string;
  apiVersion: string;
  perspective: string;
  useCdn: boolean;
}) => string;

const { createSanityCachedAccessors, createSanityCacheNamespace } =
  cacheModule as unknown as {
    createSanityCachedAccessors?: CreateSanityCachedAccessors;
    createSanityCacheNamespace?: CreateSanityCacheNamespace;
  };

test("namespaces persistent entries by Sanity client configuration", () => {
  assert.equal(typeof createSanityCacheNamespace, "function");
  assert.equal(
    createSanityCacheNamespace!({
      projectId: "storefront",
      dataset: "production",
      apiVersion: "2024-01-01",
      perspective: "published",
      useCdn: false,
    }),
    "project=storefront;dataset=production;apiVersion=2024-01-01;perspective=published;cdn=false",
  );
});

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

  const namespace =
    "project=storefront;dataset=production;apiVersion=2024-01-01;perspective=published;cdn=false";
  const accessors = createSanityCachedAccessors!(fetch, cache, namespace);
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
      keyParts: ["sanity-page", namespace, pageQuery],
      options: { revalidate: 3600, tags: ["pages"] },
    },
    {
      keyParts: ["sanity-pages", namespace, pagesQuery],
      options: { revalidate: 3600, tags: ["pages"] },
    },
    {
      keyParts: ["sanity-post", namespace, postQuery],
      options: { revalidate: 3600, tags: ["posts"] },
    },
    {
      keyParts: ["sanity-posts", namespace, postsQuery],
      options: { revalidate: 3600, tags: ["posts"] },
    },
  ]);
});
