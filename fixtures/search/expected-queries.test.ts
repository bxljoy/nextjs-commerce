import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_QUERY_CASES,
  SEARCH_INTEGRATION_DOCUMENTS,
} from "./expected-queries.ts";

const REQUIRED_CASES = new Set([
  "title boost",
  "excerpt boost",
  "body-only match",
  "English stemming",
  "two-term and",
  "no match",
  "empty-query date ordering",
]);

test("defines every required relationship without exact score expectations", () => {
  assert.deepEqual(
    new Set(EXPECTED_QUERY_CASES.map(({ name }) => name)),
    REQUIRED_CASES,
  );

  const documentIds = new Set(SEARCH_INTEGRATION_DOCUMENTS.map(({ id }) => id));
  assert.equal(documentIds.size, SEARCH_INTEGRATION_DOCUMENTS.length);
  assert.ok(SEARCH_INTEGRATION_DOCUMENTS.length > 10);

  for (const expectation of EXPECTED_QUERY_CASES) {
    assert.ok(Array.isArray(expectation.expectedIncludedIds));
    assert.ok(Array.isArray(expectation.expectedExcludedIds));
    assert.ok(Array.isArray(expectation.relativeOrder));
    assert.equal("score" in expectation, false);

    for (const id of [
      ...expectation.expectedIncludedIds,
      ...expectation.expectedExcludedIds,
      ...expectation.relativeOrder.flat(),
    ]) {
      assert.ok(documentIds.has(id), `${expectation.name}: unknown ID ${id}`);
    }
  }
});

test("isolates field boosts, body matching, stemming and AND semantics", () => {
  const byId = new Map(
    SEARCH_INTEGRATION_DOCUMENTS.map((document) => [document.id, document]),
  );
  const title = byId.get("integration.post.title");
  const excerpt = byId.get("integration.post.excerpt");
  const body = byId.get("integration.post.body");
  assert.match(title?.title ?? "", /luminous quasar/i);
  assert.doesNotMatch(title?.excerpt ?? "", /luminous quasar/i);
  assert.doesNotMatch(title?.bodyText ?? "", /luminous quasar/i);
  assert.match(excerpt?.excerpt ?? "", /luminous quasar/i);
  assert.doesNotMatch(excerpt?.title ?? "", /luminous quasar/i);
  assert.match(body?.bodyText ?? "", /luminous quasar/i);
  assert.doesNotMatch(body?.title ?? "", /luminous quasar/i);
  assert.match(byId.get("integration.post.stemming")?.bodyText ?? "", /runs/i);

  const complete = byId.get("integration.post.and-complete");
  const amberOnly = byId.get("integration.post.amber-only");
  const compassOnly = byId.get("integration.post.compass-only");
  assert.match(complete?.excerpt ?? "", /amber compass/i);
  assert.match(amberOnly?.bodyText ?? "", /amber/i);
  assert.doesNotMatch(amberOnly?.bodyText ?? "", /compass/i);
  assert.match(compassOnly?.bodyText ?? "", /compass/i);
  assert.doesNotMatch(compassOnly?.bodyText ?? "", /amber/i);
});

test("uses unique safe documents and descending dates for empty-query expectations", () => {
  const slugs = SEARCH_INTEGRATION_DOCUMENTS.map(({ slug }) => slug);
  assert.equal(new Set(slugs).size, slugs.length);

  for (const document of SEARCH_INTEGRATION_DOCUMENTS) {
    assert.match(document.id, /^integration\.post\.[a-z-]+$/);
    assert.match(document.slug, /^integration-search-[a-z-]+$/);
    assert.equal(
      new Date(document.publishedAt).toISOString(),
      document.publishedAt,
    );
    assert.equal(
      new Date(document.updatedAt).toISOString(),
      document.updatedAt,
    );
  }

  const emptyQuery = EXPECTED_QUERY_CASES.find(
    ({ name }) => name === "empty-query date ordering",
  );
  assert.ok(emptyQuery);
  assert.equal(emptyQuery.query, "");
  assert.ok(emptyQuery.relativeOrder.length > 0);
});
