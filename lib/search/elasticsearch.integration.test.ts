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
const attemptedIndexes = new Set<string>();
const REQUEST_TIMEOUT_MS = 3_000;
const READINESS_DEADLINE_MS = 30_000;
const READINESS_RETRY_MS = 500;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

type JsonRequest = {
  method: HttpMethod;
  path: string;
  body?: unknown;
  contentType?: "application/json" | "application/x-ndjson";
  acceptedStatuses?: readonly number[];
  timeoutMs?: number;
};

type RequestJson = (request: JsonRequest) => Promise<unknown>;

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
    signal: AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  if (!response.ok && !request.acceptedStatuses?.includes(response.status)) {
    throw new Error(`local Elasticsearch request failed (${response.status})`);
  }

  const text = await response.text();
  if (text === "") return {};
  return JSON.parse(text) as unknown;
}

type ReadinessDependencies = {
  request: RequestJson;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
};

async function waitForElasticsearchUntilDeadline(
  dependencies: ReadinessDependencies,
): Promise<void> {
  const deadline = dependencies.now() + READINESS_DEADLINE_MS;
  let lastError: unknown = new Error("local Elasticsearch is not ready");

  while (dependencies.now() < deadline) {
    const remaining = deadline - dependencies.now();
    try {
      await dependencies.request({
        method: "GET",
        path: "/_cluster/health",
        timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remaining),
      });
      return;
    } catch (error) {
      lastError = error;
    }

    const remainingAfterRequest = deadline - dependencies.now();
    if (remainingAfterRequest <= 0) break;
    await dependencies.sleep(
      Math.min(READINESS_RETRY_MS, remainingAfterRequest),
    );
  }

  throw lastError;
}

async function waitForElasticsearch(): Promise<void> {
  await waitForElasticsearchUntilDeadline({
    request: requestJson,
    now: Date.now,
    sleep: delay,
  });
}

type CreateIndexDependencies = {
  attemptedIndexes: Set<string>;
  ownershipMarker: string;
  request: RequestJson;
};

async function createAndPopulateIndex(
  index: string,
  documents:
    | typeof SEARCH_INTEGRATION_DOCUMENTS
    | readonly (typeof SEARCH_INTEGRATION_DOCUMENTS)[number][],
  dependencies: CreateIndexDependencies = {
    attemptedIndexes,
    ownershipMarker: TEST_ALIAS,
    request: requestJson,
  },
): Promise<void> {
  dependencies.attemptedIndexes.add(index);
  const created = await dependencies.request({
    method: "PUT",
    path: `/${index}`,
    body: {
      ...POST_INDEX_MAPPING,
      mappings: {
        ...POST_INDEX_MAPPING.mappings,
        _meta: { searchIntegrationRun: dependencies.ownershipMarker },
      },
    },
  });
  assert.equal(isRecord(created) && created.acknowledged, true);

  const bulk = await dependencies.request({
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

  await dependencies.request({
    method: "POST",
    path: `/${index}/_refresh`,
  });
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

test("tracks an ambiguously completed create with a per-run ownership marker", async () => {
  const candidate = "commerce-sanity-posts-v1760000000000";
  const attempted = new Set<string>();
  let createBody: unknown;

  await assert.rejects(
    createAndPopulateIndex(
      candidate,
      SEARCH_INTEGRATION_DOCUMENTS.slice(0, 1),
      {
        attemptedIndexes: attempted,
        ownershipMarker: "integration-run-marker",
        request: async (request) => {
          createBody = request.body;
          throw new Error("simulated lost create response");
        },
      },
    ),
    /simulated lost create response/,
  );

  const marker =
    isRecord(createBody) &&
    isRecord(createBody.mappings) &&
    isRecord(createBody.mappings._meta)
      ? createBody.mappings._meta.searchIntegrationRun
      : undefined;
  assert.deepEqual(
    { attempted: attempted.has(candidate), marker },
    { attempted: true, marker: "integration-run-marker" },
  );
});

test("cleanup deletes only exact attempted indexes carrying this run's marker", async () => {
  const owned = "commerce-sanity-posts-v1760000000001";
  const foreign = "commerce-sanity-posts-v1760000000002";
  const missing = "commerce-sanity-posts-v1760000000003";
  const requests: JsonRequest[] = [];

  await cleanupIntegrationResources({
    attemptedIndexes: [owned, foreign, missing],
    alias: "commerce-sanity-posts-integration-1760000000000",
    ownershipMarker: "integration-run-marker",
    request: async (request) => {
      requests.push(request);
      if (request.path === `/${owned}/_mapping`) {
        return {
          [owned]: {
            mappings: {
              _meta: { searchIntegrationRun: "integration-run-marker" },
            },
          },
        };
      }
      if (request.path === `/${foreign}/_mapping`) {
        return {
          [foreign]: {
            mappings: { _meta: { searchIntegrationRun: "another-run" } },
          },
        };
      }
      if (request.path === `/${missing}/_mapping`) {
        return { status: 404 };
      }
      return { acknowledged: true };
    },
  });

  assert.deepEqual(
    requests.map(({ method, path }) => `${method} ${path}`),
    [
      `GET /${owned}/_mapping`,
      `DELETE /${owned}/_alias/commerce-sanity-posts-integration-1760000000000`,
      `DELETE /${owned}`,
      `GET /${foreign}/_mapping`,
      `GET /${missing}/_mapping`,
    ],
  );
});

test("readiness uses a 30-second wall-clock deadline without a final sleep", async () => {
  let now = 0;
  const timeouts: number[] = [];
  const sleeps: number[] = [];

  await assert.rejects(
    waitForElasticsearchUntilDeadline({
      now: () => now,
      request: async (request) => {
        const timeout = request.timeoutMs ?? 0;
        timeouts.push(timeout);
        now += timeout;
        throw new Error("simulated stalled endpoint");
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    }),
    /simulated stalled endpoint/,
  );

  assert.equal(now, 30_000);
  assert.deepEqual(timeouts, [...Array<number>(8).fill(3_000), 2_000]);
  assert.deepEqual(sleeps, Array<number>(8).fill(500));
});

function hasOwnershipMarker(
  value: unknown,
  index: string,
  ownershipMarker: string,
): boolean {
  if (!isRecord(value) || !isRecord(value[index])) return false;
  const mappings = value[index].mappings;
  if (!isRecord(mappings) || !isRecord(mappings._meta)) return false;
  return mappings._meta.searchIntegrationRun === ownershipMarker;
}

type CleanupDependencies = {
  attemptedIndexes: Iterable<string>;
  alias: string;
  ownershipMarker: string;
  request: RequestJson;
};

async function cleanupIntegrationResources(
  dependencies: CleanupDependencies,
): Promise<void> {
  const cleanupErrors: unknown[] = [];
  for (const index of dependencies.attemptedIndexes) {
    try {
      const mapping = await dependencies.request({
        method: "GET",
        path: `/${index}/_mapping`,
        acceptedStatuses: [404],
      });
      if (!hasOwnershipMarker(mapping, index, dependencies.ownershipMarker)) {
        continue;
      }

      try {
        await dependencies.request({
          method: "DELETE",
          path: `/${index}/_alias/${dependencies.alias}`,
          acceptedStatuses: [404],
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await dependencies.request({
          method: "DELETE",
          path: `/${index}`,
          acceptedStatuses: [404],
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "integration cleanup failed");
  }
}

after(async () => {
  await cleanupIntegrationResources({
    attemptedIndexes,
    alias: TEST_ALIAS,
    ownershipMarker: TEST_ALIAS,
    request: requestJson,
  });
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
