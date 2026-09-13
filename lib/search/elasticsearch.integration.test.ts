import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { after, test } from "node:test";
import {
  EXPECTED_QUERY_CASES,
  SEARCH_INTEGRATION_DOCUMENTS,
} from "../../fixtures/search/expected-queries.ts";
import { buildBulkBody } from "../../scripts/search/indexer.ts";
import { POST_INDEX_MAPPING } from "./mapping.ts";
import { searchPosts } from "./service.ts";

const ELASTICSEARCH_URL = "http://127.0.0.1:9200";
const RUN_TIMESTAMP = Date.now();
const FIRST_INDEX = `commerce-sanity-posts-v${RUN_TIMESTAMP}`;
const SECOND_INDEX = `commerce-sanity-posts-v${RUN_TIMESTAMP + 1}`;
const TEST_ALIAS = `commerce-sanity-posts-integration-${RUN_TIMESTAMP}`;
const createdIndexes = new Set<string>();
let aliasTarget: string | null = null;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

type JsonRequest = {
  method: HttpMethod;
  path: string;
  body?: unknown;
  contentType?: "application/json" | "application/x-ndjson";
  acceptedStatuses?: readonly number[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestJson(request: JsonRequest): Promise<unknown> {
  const url = new URL(request.path, ELASTICSEARCH_URL);
  assert.equal(url.origin, new URL(ELASTICSEARCH_URL).origin);

  const response = await fetch(url, {
    method: request.method,
    cache: "no-store",
    headers:
      request.body === undefined
        ? undefined
        : { "content-type": request.contentType ?? "application/json" },
    body:
      request.body === undefined
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok && !request.acceptedStatuses?.includes(response.status)) {
    throw new Error(`local Elasticsearch request failed (${response.status})`);
  }

  const text = await response.text();
  if (text === "") return {};
  return JSON.parse(text) as unknown;
}

async function waitForElasticsearch(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await requestJson({ method: "GET", path: "/_cluster/health" });
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw lastError;
}

async function createAndPopulateIndex(
  index: string,
  documents:
    | typeof SEARCH_INTEGRATION_DOCUMENTS
    | readonly (typeof SEARCH_INTEGRATION_DOCUMENTS)[number][],
): Promise<void> {
  const created = await requestJson({
    method: "PUT",
    path: `/${index}`,
    body: POST_INDEX_MAPPING,
  });
  createdIndexes.add(index);
  assert.equal(isRecord(created) && created.acknowledged, true);

  const bulk = await requestJson({
    method: "POST",
    path: `/${index}/_bulk`,
    body: buildBulkBody(documents),
    contentType: "application/x-ndjson",
  });
  assert.equal(isRecord(bulk) && bulk.errors, false);
  assert.equal(isRecord(bulk) && Array.isArray(bulk.items), true);
  assert.equal(
    isRecord(bulk) && Array.isArray(bulk.items) ? bulk.items.length : -1,
    documents.length,
  );

  await requestJson({ method: "POST", path: `/${index}/_refresh` });
}

async function swapAlias(
  oldIndex: string | null,
  newIndex: string,
): Promise<void> {
  const response = await requestJson({
    method: "POST",
    path: "/_aliases",
    body: {
      actions: [
        ...(oldIndex
          ? [{ remove: { index: oldIndex, alias: TEST_ALIAS } }]
          : []),
        {
          add: {
            index: newIndex,
            alias: TEST_ALIAS,
            is_write_index: false,
          },
        },
      ],
    },
  });
  assert.equal(isRecord(response) && response.acknowledged, true);
  aliasTarget = newIndex;
}

function assertExpectedRelationships(
  resultIds: readonly string[],
  expectation: (typeof EXPECTED_QUERY_CASES)[number],
): void {
  for (const id of expectation.expectedIncludedIds) {
    assert.ok(resultIds.includes(id), `${expectation.name}: expected ${id}`);
  }
  for (const id of expectation.expectedExcludedIds) {
    assert.equal(
      resultIds.includes(id),
      false,
      `${expectation.name}: did not expect ${id}`,
    );
  }
  for (const [beforeId, afterId] of expectation.relativeOrder) {
    const before = resultIds.indexOf(beforeId);
    const after = resultIds.indexOf(afterId);
    assert.ok(
      before >= 0 && after >= 0 && before < after,
      `${expectation.name}: expected ${beforeId} before ${afterId}`,
    );
  }
}

after(async () => {
  const cleanupErrors: unknown[] = [];
  if (aliasTarget !== null) {
    try {
      await requestJson({
        method: "DELETE",
        path: `/${aliasTarget}/_alias/${TEST_ALIAS}`,
        acceptedStatuses: [404],
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  for (const index of createdIndexes) {
    try {
      await requestJson({
        method: "DELETE",
        path: `/${index}`,
        acceptedStatuses: [404],
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  assert.deepEqual(cleanupErrors, []);
});

test(
  "real Elasticsearch honors analysis, ranking, pagination and rebuild removal",
  {
    skip:
      process.env.ELASTICSEARCH_INTEGRATION === "1"
        ? false
        : "set ELASTICSEARCH_INTEGRATION=1 to run the loopback-only Docker integration test",
  },
  async () => {
    await waitForElasticsearch();
    await createAndPopulateIndex(FIRST_INDEX, SEARCH_INTEGRATION_DOCUMENTS);
    await swapAlias(null, FIRST_INDEX);

    for (const expectation of EXPECTED_QUERY_CASES) {
      const response = await searchPosts(
        { query: expectation.query, page: 1 },
        {
          baseUrl: ELASTICSEARCH_URL,
          alias: TEST_ALIAS,
          fetch,
        },
      );
      const resultIds = response.results.map(({ id }) => id);
      assert.equal(response.total, expectation.expectedTotal, expectation.name);
      assertExpectedRelationships(resultIds, expectation);
    }

    const firstPage = await searchPosts(
      { query: "", page: 1 },
      { baseUrl: ELASTICSEARCH_URL, alias: TEST_ALIAS, fetch },
    );
    const secondPage = await searchPosts(
      { query: "", page: 2 },
      { baseUrl: ELASTICSEARCH_URL, alias: TEST_ALIAS, fetch },
    );
    assert.equal(firstPage.total, SEARCH_INTEGRATION_DOCUMENTS.length);
    assert.equal(secondPage.total, SEARCH_INTEGRATION_DOCUMENTS.length);
    assert.equal(firstPage.results.length, 10);
    assert.equal(
      secondPage.results.length,
      SEARCH_INTEGRATION_DOCUMENTS.length - 10,
    );
    const firstPageIds = new Set(firstPage.results.map(({ id }) => id));
    assert.equal(
      secondPage.results.some(({ id }) => firstPageIds.has(id)),
      false,
    );

    const removedId = "integration.post.body-only";
    const rebuiltDocuments = SEARCH_INTEGRATION_DOCUMENTS.filter(
      ({ id }) => id !== removedId,
    );
    await createAndPopulateIndex(SECOND_INDEX, rebuiltDocuments);
    await swapAlias(FIRST_INDEX, SECOND_INDEX);

    const afterRebuild = await searchPosts(
      { query: "cerulean nebula", page: 1 },
      { baseUrl: ELASTICSEARCH_URL, alias: TEST_ALIAS, fetch },
    );
    assert.equal(afterRebuild.total, 0);
    assert.equal(
      afterRebuild.results.some(({ id }) => id === removedId),
      false,
    );

    const rebuiltListing = await searchPosts(
      { query: "", page: 1 },
      { baseUrl: ELASTICSEARCH_URL, alias: TEST_ALIAS, fetch },
    );
    assert.equal(rebuiltListing.total, rebuiltDocuments.length);
  },
);
