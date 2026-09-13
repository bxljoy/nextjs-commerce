import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeLabIndexName, readSearchLabConfig } from "./config.ts";

test("accepts the loopback-only search lab", () => {
  assert.deepEqual(
    readSearchLabConfig({
      ELASTICSEARCH_URL: "http://127.0.0.1:9200",
      ELASTICSEARCH_INDEX_ALIAS: "commerce-sanity-posts",
    }),
    {
      elasticsearchUrl: "http://127.0.0.1:9200",
      indexAlias: "commerce-sanity-posts",
    },
  );

  assert.deepEqual(
    readSearchLabConfig({
      ELASTICSEARCH_URL: "http://localhost:9200",
      ELASTICSEARCH_INDEX_ALIAS: "commerce-sanity-posts",
    }),
    {
      elasticsearchUrl: "http://localhost:9200",
      indexAlias: "commerce-sanity-posts",
    },
  );
});

test("rejects a remote Elasticsearch endpoint", () => {
  assert.throws(() =>
    readSearchLabConfig({
      ELASTICSEARCH_URL: "http://search.example.com:9200",
      ELASTICSEARCH_INDEX_ALIAS: "commerce-sanity-posts",
    }),
  );
});

test("rejects credentials in the Elasticsearch endpoint", () => {
  assert.throws(() =>
    readSearchLabConfig({
      ELASTICSEARCH_URL: "http://elastic:secret@127.0.0.1:9200",
      ELASTICSEARCH_INDEX_ALIAS: "commerce-sanity-posts",
    }),
  );
});

test("rejects paths, query strings, and fragments in the Elasticsearch endpoint", () => {
  for (const elasticsearchUrl of [
    "http://127.0.0.1:9200/search",
    "http://127.0.0.1:9200?pretty=true",
    "http://127.0.0.1:9200#search",
  ]) {
    assert.throws(() =>
      readSearchLabConfig({
        ELASTICSEARCH_URL: elasticsearchUrl,
        ELASTICSEARCH_INDEX_ALIAS: "commerce-sanity-posts",
      }),
    );
  }
});

test("rejects invalid Elasticsearch ports", () => {
  for (const elasticsearchUrl of [
    "http://127.0.0.1",
    "http://127.0.0.1:9201",
    "http://localhost:9201",
  ]) {
    assert.throws(() =>
      readSearchLabConfig({
        ELASTICSEARCH_URL: elasticsearchUrl,
        ELASTICSEARCH_INDEX_ALIAS: "commerce-sanity-posts",
      }),
    );
  }
});

test("accepts only the lab alias and timestamped generated index names", () => {
  assert.doesNotThrow(() => assertSafeLabIndexName("commerce-sanity-posts"));
  assert.doesNotThrow(() =>
    assertSafeLabIndexName("commerce-sanity-posts-v1757721600000"),
  );

  for (const indexName of [
    "posts",
    "commerce-sanity-posts-v175772160000",
    "commerce-sanity-posts-v17577216000000",
    "commerce-sanity-posts-vabcdefghijklm",
  ]) {
    assert.throws(() => assertSafeLabIndexName(indexName));
  }
});

test("requires the exact lab alias in configuration", () => {
  for (const indexAlias of [
    undefined,
    "posts",
    "commerce-sanity-posts-v1757721600000",
  ]) {
    assert.throws(() =>
      readSearchLabConfig({
        ELASTICSEARCH_URL: "http://127.0.0.1:9200",
        ELASTICSEARCH_INDEX_ALIAS: indexAlias,
      }),
    );
  }
});
