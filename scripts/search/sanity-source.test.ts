import assert from "node:assert/strict";
import test from "node:test";
import {
  createSearchSanityClient,
  fetchPublishedPostCorpus,
  searchPostCorpusQuery,
} from "./sanity-source.ts";

const sourcePost = {
  _id: "post-1",
  title: "Search projection",
  slug: "search-projection",
  publishedAt: "2026-09-01T00:00:00.000Z",
  excerpt: "A projected excerpt",
  body: [
    {
      _key: "block-1",
      _type: "block",
      style: "normal",
      markDefs: [],
      children: [
        {
          _key: "span-1",
          _type: "span",
          marks: [],
          text: "Only plain text is indexed.",
        },
      ],
    },
  ],
  _updatedAt: "2026-09-02T00:00:00.000Z",
};

test("uses the complete allowlisted post corpus query verbatim", () => {
  assert.equal(
    searchPostCorpusQuery,
    `
  *[_type == "post" && defined(slug.current)]{
    _id,
    title,
    "slug": slug.current,
    publishedAt,
    excerpt,
    body,
    _updatedAt
  }
`,
  );
});

test("creates a dedicated published, non-CDN script client", () => {
  const client = createSearchSanityClient({
    SANITY_PROJECT_ID: "project123",
    SANITY_DATASET: "production",
  });

  assert.deepEqual(
    {
      projectId: client.config().projectId,
      dataset: client.config().dataset,
      perspective: client.config().perspective,
      useCdn: client.config().useCdn,
    },
    {
      projectId: "project123",
      dataset: "production",
      perspective: "published",
      useCdn: false,
    },
  );
});

test("fetches once and validates every projected source document", async () => {
  const queries: string[] = [];
  const documents = await fetchPublishedPostCorpus({
    fetch: async (query: string) => {
      queries.push(query);
      return [sourcePost];
    },
  });

  assert.deepEqual(queries, [searchPostCorpusQuery]);
  assert.deepEqual(documents, [
    {
      id: "post-1",
      title: "Search projection",
      slug: "search-projection",
      publishedAt: "2026-09-01T00:00:00.000Z",
      excerpt: "A projected excerpt",
      bodyText: "Only plain text is indexed.",
      updatedAt: "2026-09-02T00:00:00.000Z",
    },
  ]);
});

test("never converts a source error or malformed result to an empty corpus", async () => {
  await assert.rejects(
    fetchPublishedPostCorpus({
      fetch: async () => {
        throw new Error("Sanity unavailable");
      },
    }),
    /Sanity unavailable/,
  );

  for (const result of [null, undefined, {}, "not-an-array"]) {
    await assert.rejects(
      fetchPublishedPostCorpus({ fetch: async () => result }),
      /array/,
    );
  }

  await assert.rejects(
    fetchPublishedPostCorpus({
      fetch: async () => [{ ...sourcePost, title: "" }],
    }),
    /title/,
  );
});

test("rejects duplicate IDs and duplicate slugs", async () => {
  await assert.rejects(
    fetchPublishedPostCorpus({
      fetch: async () => [sourcePost, { ...sourcePost, slug: "another-slug" }],
    }),
    /duplicate Sanity ID: post-1/,
  );

  await assert.rejects(
    fetchPublishedPostCorpus({
      fetch: async () => [sourcePost, { ...sourcePost, _id: "post-2" }],
    }),
    /duplicate Sanity slug: search-projection/,
  );
});
