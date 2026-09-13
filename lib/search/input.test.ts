import assert from "node:assert/strict";
import test from "node:test";
import { parseSearchInput } from "./input.ts";

test("parses a normal query and page", () => {
  assert.deepEqual(parseSearchInput({ q: "  cache layers  ", page: "2" }), {
    ok: true,
    value: {
      query: "cache layers",
      page: 2,
    },
  });
});

test("defaults absent and blank queries to the first unfiltered page", () => {
  assert.deepEqual(parseSearchInput({}), {
    ok: true,
    value: { query: "", page: 1 },
  });
  assert.deepEqual(parseSearchInput({ q: "  \t\n " }), {
    ok: true,
    value: { query: "", page: 1 },
  });
});

test("accepts a trimmed query at the 200-character maximum", () => {
  const query = "x".repeat(200);

  assert.deepEqual(parseSearchInput({ q: `  ${query}  ` }), {
    ok: true,
    value: { query, page: 1 },
  });
});

test("rejects queries longer than 200 characters", () => {
  assert.deepEqual(parseSearchInput({ q: "x".repeat(201) }), {
    ok: false,
    message: "Query must be 200 characters or fewer.",
  });
});

test("rejects repeated query parameters", () => {
  assert.deepEqual(parseSearchInput({ q: ["cache", "sanity"] }), {
    ok: false,
    message: "Search parameters must not be repeated.",
  });
});

test("rejects repeated page parameters", () => {
  assert.deepEqual(parseSearchInput({ page: ["1", "2"] }), {
    ok: false,
    message: "Search parameters must not be repeated.",
  });
});

test("rejects noninteger, negative, zero, blank, and over-100 pages", () => {
  for (const page of ["1.5", "-1", "0", "", "101", "2e1", " 2 "]) {
    const result = parseSearchInput({ page });

    assert.deepEqual(
      result,
      {
        ok: false,
        message: "Page must be an integer from 1 to 100.",
      },
      `expected page ${JSON.stringify(page)} to be rejected`,
    );
  }
});

test("keeps HTML-like query text as data", () => {
  assert.deepEqual(
    parseSearchInput({ q: "<script>alert('search')</script>" }),
    {
      ok: true,
      value: {
        query: "<script>alert('search')</script>",
        page: 1,
      },
    },
  );
});
