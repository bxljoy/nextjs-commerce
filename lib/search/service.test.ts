import assert from "node:assert/strict";
import test from "node:test";
import { SearchUnavailableError } from "./elasticsearch.ts";
import { searchPosts } from "./service.ts";

const validSource = {
  id: "post-1",
  slug: "cache-boundaries",
  title: "Cache boundaries",
  excerpt: "A concise summary",
  publishedAt: "2026-09-01T00:00:00.000Z",
};

function searchResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("maps validated hits, exact totals, scores, and the fixed page size", async () => {
  const page = await searchPosts(
    { query: "cache", page: 2 },
    {
      baseUrl: "http://127.0.0.1:9200",
      alias: "commerce-sanity-posts",
      fetch: async () =>
        searchResponse({
          hits: {
            total: { value: 11, relation: "eq" },
            hits: [
              { _score: 8.25, _source: validSource },
              {
                _score: null,
                _source: {
                  ...validSource,
                  id: "post-2",
                  slug: "sanity-projections",
                  title: "Sanity projections",
                },
              },
            ],
          },
        }),
    },
  );

  assert.deepEqual(page, {
    results: [
      { ...validSource, score: 8.25 },
      {
        ...validSource,
        id: "post-2",
        slug: "sanity-projections",
        title: "Sanity projections",
        score: null,
      },
    ],
    total: 11,
    page: 2,
    pageSize: 10,
  });
});

test("calls the encoded alias search path with the constructed query", async () => {
  let capturedUrl: string | undefined;
  let capturedBody: unknown;

  await searchPosts(
    { query: "cache layers", page: 2 },
    {
      baseUrl: "http://127.0.0.1:9200",
      alias: "alias/with space",
      fetch: async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));
        return searchResponse({
          hits: { total: { value: 0, relation: "eq" }, hits: [] },
        });
      },
    },
  );

  assert.equal(
    capturedUrl,
    "http://127.0.0.1:9200/alias%2Fwith%20space/_search",
  );
  assert.deepEqual(capturedBody, {
    from: 10,
    size: 10,
    track_total_hits: true,
    _source: ["id", "slug", "title", "excerpt", "publishedAt"],
    query: {
      multi_match: {
        query: "cache layers",
        type: "best_fields",
        fields: ["title^3", "excerpt^2", "bodyText"],
        operator: "and",
      },
    },
    sort: [{ _score: "desc" }, { id: "asc" }],
  });
});

test("reports Elasticsearch failures as search unavailable", async () => {
  await assert.rejects(
    searchPosts(
      { query: "cache", page: 1 },
      {
        baseUrl: "http://127.0.0.1:9200",
        alias: "commerce-sanity-posts",
        fetch: async () => {
          throw new Error("private socket detail");
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SearchUnavailableError);
      assert.doesNotMatch(error.message, /private socket detail/);
      return true;
    },
  );
});

test("rejects inexact or malformed total counts", async (t) => {
  for (const total of [
    { value: 1, relation: "gte" },
    { value: -1, relation: "eq" },
    { value: 1.5, relation: "eq" },
    1,
  ]) {
    await t.test(JSON.stringify(total), async () => {
      await assert.rejects(
        searchPosts(
          { query: "", page: 1 },
          {
            baseUrl: "http://127.0.0.1:9200",
            alias: "commerce-sanity-posts",
            fetch: async () => searchResponse({ hits: { total, hits: [] } }),
          },
        ),
        SearchUnavailableError,
      );
    });
  }
});

test("rejects malformed hit scores", async () => {
  await assert.rejects(
    searchPosts(
      { query: "cache", page: 1 },
      {
        baseUrl: "http://127.0.0.1:9200",
        alias: "commerce-sanity-posts",
        fetch: async () =>
          searchResponse({
            hits: {
              total: { value: 1, relation: "eq" },
              hits: [{ _score: "8.25", _source: validSource }],
            },
          }),
      },
    ),
    SearchUnavailableError,
  );
});

test("rejects malformed source documents before rendering", async (t) => {
  const malformedSources: Array<[string, unknown]> = [
    ["missing source", undefined],
    ["empty id", { ...validSource, id: "" }],
    ["unsafe slug", { ...validSource, slug: "../private" }],
    ["empty title", { ...validSource, title: "  " }],
    ["non-string excerpt", { ...validSource, excerpt: null }],
    ["invalid published date", { ...validSource, publishedAt: "yesterday" }],
  ];

  for (const [name, source] of malformedSources) {
    await t.test(name, async () => {
      await assert.rejects(
        searchPosts(
          { query: "cache", page: 1 },
          {
            baseUrl: "http://127.0.0.1:9200",
            alias: "commerce-sanity-posts",
            fetch: async () =>
              searchResponse({
                hits: {
                  total: { value: 1, relation: "eq" },
                  hits: [{ _score: 1, _source: source }],
                },
              }),
          },
        ),
        SearchUnavailableError,
      );
    });
  }
});
