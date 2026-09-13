import assert from "node:assert/strict";
import test from "node:test";
import { buildPostSearchRequest } from "./query.ts";

test("builds a deterministic paginated request for a nonempty query", () => {
  assert.deepEqual(buildPostSearchRequest({ query: "cache layers", page: 2 }), {
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

test("builds an ordered match-all request for an empty query", () => {
  assert.deepEqual(buildPostSearchRequest({ query: "", page: 1 }), {
    from: 0,
    size: 10,
    track_total_hits: true,
    _source: ["id", "slug", "title", "excerpt", "publishedAt"],
    query: { match_all: {} },
    sort: [{ publishedAt: "desc" }, { id: "asc" }],
  });
});

test("keeps HTML-like text inside the structured multi-match query", () => {
  const query = "<script>alert('search')</script>";

  assert.deepEqual(buildPostSearchRequest({ query, page: 100 }), {
    from: 990,
    size: 10,
    track_total_hits: true,
    _source: ["id", "slug", "title", "excerpt", "publishedAt"],
    query: {
      multi_match: {
        query,
        type: "best_fields",
        fields: ["title^3", "excerpt^2", "bodyText"],
        operator: "and",
      },
    },
    sort: [{ _score: "desc" }, { id: "asc" }],
  });
});
