import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SearchPostDocument } from "../../lib/search/contracts.ts";
import { POST_INDEX_MAPPING } from "../../lib/search/mapping.ts";
import {
  buildBulkBody,
  synchronizePostIndex,
  type IndexerHttpRequest,
} from "./indexer.ts";
import { runSearchSync } from "./sync.ts";

const NOW = 1_757_721_600_000;
const NEW_INDEX = "commerce-sanity-posts-v1757721600000";
const OLD_INDEX = "commerce-sanity-posts-v1757635200000";
const ALIAS = "commerce-sanity-posts";

function document(id: string, slug = id): SearchPostDocument {
  return {
    id,
    slug,
    title: `Title ${id}`,
    excerpt: `Excerpt ${id}`,
    bodyText: `Body ${id}`,
    publishedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

function idsFromBulkBody(body: unknown): string[] {
  if (typeof body !== "string") {
    throw new TypeError("bulk body must be a string");
  }
  const lines = body.trimEnd().split("\n");
  const ids: string[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const action = JSON.parse(lines[index] ?? "") as {
      index: { _id: string };
    };
    ids.push(action.index._id);
  }
  return ids;
}

function successfulHttp(
  documents: readonly SearchPostDocument[],
  oldIndex: string | null = OLD_INDEX,
) {
  const requests: IndexerHttpRequest[] = [];
  const http = async (request: IndexerHttpRequest): Promise<unknown> => {
    requests.push(request);

    if (request.path === `/_alias/${ALIAS}`) {
      return oldIndex ? { [oldIndex]: { aliases: { [ALIAS]: {} } } } : {};
    }
    if (request.path === `/${OLD_INDEX}/_count`) {
      return { count: 1 };
    }
    if (request.path === `/${NEW_INDEX}` && request.method === "PUT") {
      return { acknowledged: true };
    }
    if (request.path === `/${NEW_INDEX}/_bulk`) {
      return {
        errors: false,
        items: idsFromBulkBody(request.body).map((id) => ({
          index: { _id: id, status: 201 },
        })),
      };
    }
    if (request.path === `/${NEW_INDEX}/_refresh`) {
      return { _shards: { successful: 1 } };
    }
    if (request.path === `/${NEW_INDEX}/_count`) {
      return { count: documents.length };
    }
    if (request.path === `/${NEW_INDEX}/_search`) {
      return {
        hits: {
          total: { value: documents.length, relation: "eq" },
          hits: documents.map(({ id }) => ({ _id: id })),
        },
      };
    }
    if (request.path === "/_aliases") {
      return { acknowledged: true };
    }
    if (request.path === `/${NEW_INDEX}` && request.method === "DELETE") {
      return { acknowledged: true };
    }

    throw new Error(`Unexpected request: ${request.method} ${request.path}`);
  };
  return { http, requests };
}

test("builds newline-delimited bulk action/source pairs using each Sanity ID", () => {
  const first = document("post-1", "post-one");
  const second = document("post-2", "post-two");
  const body = buildBulkBody([first, second]);

  assert.equal(
    body,
    `${JSON.stringify({ index: { _id: "post-1" } })}\n${JSON.stringify(first)}\n${JSON.stringify({ index: { _id: "post-2" } })}\n${JSON.stringify(second)}\n`,
  );
});

test("creates the timestamped strict index, validates it, then swaps one alias atomically", async () => {
  const documents = [document("post-1", "post-one")];
  const { http, requests } = successfulHttp(documents);

  const result = await synchronizePostIndex({
    alias: ALIAS,
    documents,
    http,
    now: () => NOW,
  });

  assert.deepEqual(result, {
    oldIndex: OLD_INDEX,
    newIndex: NEW_INDEX,
    sourceCount: 1,
    indexedCount: 1,
  });
  assert.match(result.newIndex, /^commerce-sanity-posts-v[0-9]{13}$/);

  const create = requests.find(
    ({ method, path }) => method === "PUT" && path === `/${NEW_INDEX}`,
  );
  assert.deepEqual(create?.body, POST_INDEX_MAPPING);

  const bulk = requests.find(({ path }) => path === `/${NEW_INDEX}/_bulk`);
  assert.equal(bulk?.contentType, "application/x-ndjson");
  assert.deepEqual(idsFromBulkBody(bulk?.body), ["post-1"]);

  const refreshIndex = requests.findIndex(
    ({ method, path }) =>
      method === "POST" && path === `/${NEW_INDEX}/_refresh`,
  );
  const countIndex = requests.findIndex(
    ({ method, path }) => method === "GET" && path === `/${NEW_INDEX}/_count`,
  );
  const idSetIndex = requests.findIndex(
    ({ method, path }) => method === "POST" && path === `/${NEW_INDEX}/_search`,
  );
  const promoteIndex = requests.findIndex(
    ({ method, path }) => method === "POST" && path === "/_aliases",
  );
  assert.ok(refreshIndex < countIndex && countIndex < idSetIndex);
  assert.ok(idSetIndex < promoteIndex);
  assert.deepEqual(requests[idSetIndex]?.body, {
    size: 1,
    query: { match_all: {} },
    _source: false,
    sort: [{ id: "asc" }],
    track_total_hits: true,
  });
  assert.deepEqual(requests[promoteIndex]?.body, {
    actions: [
      { remove: { index: OLD_INDEX, alias: ALIAS } },
      { add: { index: NEW_INDEX, alias: ALIAS, is_write_index: false } },
    ],
  });
});

test("accepts an absent alias and promotes with only the add action", async () => {
  const documents = [document("post-1")];
  const { http, requests } = successfulHttp(documents, null);

  await synchronizePostIndex({
    alias: ALIAS,
    documents,
    http,
    now: () => NOW,
  });

  assert.deepEqual(requests.find(({ path }) => path === "/_aliases")?.body, {
    actions: [
      { add: { index: NEW_INDEX, alias: ALIAS, is_write_index: false } },
    ],
  });
});

test("rejects multiple alias targets before creating an index", async () => {
  const requests: IndexerHttpRequest[] = [];
  await assert.rejects(
    synchronizePostIndex({
      alias: ALIAS,
      documents: [document("post-1")],
      now: () => NOW,
      http: async (request) => {
        requests.push(request);
        return {
          [OLD_INDEX]: { aliases: { [ALIAS]: {} } },
          "commerce-sanity-posts-v1757548800000": {
            aliases: { [ALIAS]: {} },
          },
        };
      },
    }),
    /multiple indices/,
  );
  assert.deepEqual(
    requests.map(({ method, path }) => `${method} ${path}`),
    [`GET /_alias/${ALIAS}`],
  );
});

test("inspects every bulk item even when Elasticsearch returns HTTP 200", async () => {
  const documents = [document("post-1"), document("post-2")];
  let inspectedStatuses = 0;
  const requests: IndexerHttpRequest[] = [];

  await assert.rejects(
    synchronizePostIndex({
      alias: ALIAS,
      documents,
      now: () => NOW,
      http: async (request) => {
        requests.push(request);
        if (request.path === `/_alias/${ALIAS}`) return {};
        if (request.method === "PUT") return { acknowledged: true };
        if (request.path === `/${NEW_INDEX}/_bulk`) {
          return {
            errors: true,
            items: [500, 201].map((status, index) => ({
              index: {
                _id: documents[index]?.id,
                get status() {
                  inspectedStatuses += 1;
                  return status;
                },
              },
            })),
          };
        }
        if (request.method === "DELETE") return { acknowledged: true };
        throw new Error(
          `Unexpected request: ${request.method} ${request.path}`,
        );
      },
    }),
    /bulk indexing failed/,
  );

  assert.equal(inspectedStatuses, 2);
  assert.equal(
    requests.some(({ path }) => path === "/_aliases"),
    false,
  );
});

test("batches at most 100 documents per bulk request", async () => {
  const documents = Array.from({ length: 101 }, (_, index) =>
    document(`post-${String(index + 1).padStart(3, "0")}`),
  );
  const { http, requests } = successfulHttp(documents, null);

  await synchronizePostIndex({
    alias: ALIAS,
    documents,
    http,
    now: () => NOW,
  });

  const bulkRequests = requests.filter(
    ({ path }) => path === `/${NEW_INDEX}/_bulk`,
  );
  assert.deepEqual(
    bulkRequests.map(({ body }) => idsFromBulkBody(body).length),
    [100, 1],
  );
});

test("count or complete ID-set validation failures never promote and clean up only the new index", async () => {
  for (const failure of ["count", "ids"] as const) {
    const requests: IndexerHttpRequest[] = [];
    const recoveryReports: unknown[] = [];
    const documents = [document("post-1")];

    await assert.rejects(
      synchronizePostIndex({
        alias: ALIAS,
        documents,
        now: () => NOW,
        writeRecoveryReport: async (report) => {
          recoveryReports.push(report);
        },
        http: async (request) => {
          requests.push(request);
          if (request.path === `/_alias/${ALIAS}`) {
            return { [OLD_INDEX]: { aliases: { [ALIAS]: {} } } };
          }
          if (request.method === "PUT") return { acknowledged: true };
          if (request.path === `/${NEW_INDEX}/_bulk`) {
            return {
              errors: false,
              items: [{ index: { _id: "post-1", status: 201 } }],
            };
          }
          if (request.path.endsWith("/_refresh")) return {};
          if (request.path.endsWith("/_count")) {
            return { count: failure === "count" ? 0 : 1 };
          }
          if (request.path.endsWith("/_search")) {
            return {
              hits: {
                total: { value: 1, relation: "eq" },
                hits: [{ _id: "wrong-id" }],
              },
            };
          }
          if (request.method === "DELETE") return { acknowledged: true };
          throw new Error(
            `Unexpected request: ${request.method} ${request.path}`,
          );
        },
      }),
      failure === "count" ? /count validation failed/ : /ID validation failed/,
    );

    assert.equal(
      requests.some(({ path }) => path === "/_aliases"),
      false,
    );
    assert.deepEqual(
      requests
        .filter(({ method }) => method === "DELETE")
        .map(({ path }) => path),
      [`/${NEW_INDEX}`],
    );
    assert.deepEqual(recoveryReports, [
      {
        oldIndex: OLD_INDEX,
        newIndex: NEW_INDEX,
        sourceCount: 1,
        indexedCount: failure === "count" ? 0 : 1,
      },
    ]);
  }
});

test("a promotion failure attempts exact new-index cleanup without a second alias request", async () => {
  const documents = [document("post-1")];
  const { http: baseHttp, requests } = successfulHttp(documents);

  await assert.rejects(
    synchronizePostIndex({
      alias: ALIAS,
      documents,
      now: () => NOW,
      http: async (request) => {
        if (request.path === "/_aliases") {
          requests.push(request);
          throw new Error("promotion failed");
        }
        return baseHttp(request);
      },
    }),
    /promotion failed/,
  );

  assert.equal(requests.filter(({ path }) => path === "/_aliases").length, 1);
  assert.deepEqual(
    requests
      .filter(({ method }) => method === "DELETE")
      .map(({ path }) => path),
    [`/${NEW_INDEX}`],
  );
});

test("refuses to replace a nonempty old index with an empty source unless allowEmpty is true", async () => {
  const refused = successfulHttp([], OLD_INDEX);
  await assert.rejects(
    synchronizePostIndex({
      alias: ALIAS,
      documents: [],
      http: refused.http,
      now: () => NOW,
    }),
    /empty source/,
  );
  assert.equal(
    refused.requests.some(
      ({ method, path }) => method === "PUT" && path === `/${NEW_INDEX}`,
    ),
    false,
  );

  const allowed = successfulHttp([], OLD_INDEX);
  await synchronizePostIndex({
    alias: ALIAS,
    documents: [],
    http: allowed.http,
    now: () => NOW,
    allowEmpty: true,
  });
  assert.equal(
    allowed.requests.some(({ path }) => path === `/${NEW_INDEX}/_bulk`),
    false,
  );
  assert.ok(allowed.requests.some(({ path }) => path === "/_aliases"));
});

const syncEnv = {
  SANITY_PROJECT_ID: "project123",
  SANITY_DATASET: "production",
  ELASTICSEARCH_URL: "http://127.0.0.1:9200",
  ELASTICSEARCH_INDEX_ALIAS: ALIAS,
};

test("manual sync defaults to dry-run and performs no Elasticsearch writes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "search-sync-test-"));
  const requests: IndexerHttpRequest[] = [];
  const logs: string[] = [];
  try {
    const result = await runSearchSync({
      argv: [],
      cwd,
      env: syncEnv,
      sanityClient: { fetch: async () => [] },
      http: async (request) => {
        requests.push(request);
        return {};
      },
      now: () => NOW,
      log: (message) => logs.push(message),
    });

    assert.deepEqual(result, { mode: "dry-run", sourceCount: 0 });
    assert.deepEqual(requests, []);
    assert.deepEqual(logs, [
      "Dry run: validated 0 published posts; no index changes.",
    ]);
    await assert.rejects(readFile(join(cwd, ".search-lab", "sync.lock")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("manual sync reports and stops when the exclusive lock already exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "search-sync-test-"));
  const lockDirectory = join(cwd, ".search-lab");
  await mkdir(lockDirectory);
  await writeFile(join(lockDirectory, "sync.lock"), "occupied");
  let sourceReads = 0;
  try {
    await assert.rejects(
      runSearchSync({
        argv: ["--apply"],
        cwd,
        env: syncEnv,
        sanityClient: {
          fetch: async () => {
            sourceReads += 1;
            return [];
          },
        },
        http: async () => ({}),
        now: () => NOW,
        log: () => {},
      }),
      /sync lock already exists/,
    );
    assert.equal(sourceReads, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("apply failures write only bounded recovery metadata and always release the lock", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "search-sync-test-"));
  const documents = [document("post-1")];
  const requests: IndexerHttpRequest[] = [];
  try {
    await assert.rejects(
      runSearchSync({
        argv: ["--apply"],
        cwd,
        env: syncEnv,
        sanityClient: {
          fetch: async () => [
            {
              _id: "post-1",
              title: "Title post-1",
              slug: "post-1",
              excerpt: "Excerpt post-1",
              body: [],
              publishedAt: "2026-09-01T00:00:00.000Z",
              _updatedAt: "2026-09-02T00:00:00.000Z",
            },
          ],
        },
        http: async (request) => {
          requests.push(request);
          if (request.path === `/_alias/${ALIAS}`) return {};
          if (request.method === "PUT") return { acknowledged: true };
          if (request.path === `/${NEW_INDEX}/_bulk`) {
            return {
              errors: false,
              items: [{ index: { _id: documents[0]?.id, status: 201 } }],
            };
          }
          if (request.path.endsWith("/_refresh")) return {};
          if (request.path.endsWith("/_count")) return { count: 0 };
          if (request.method === "DELETE") return { acknowledged: true };
          throw new Error(
            `Unexpected request: ${request.method} ${request.path}`,
          );
        },
        now: () => NOW,
        log: () => {},
      }),
      /count validation failed/,
    );

    const report = JSON.parse(
      await readFile(join(cwd, ".search-lab", "sync-recovery.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(report, {
      oldIndex: null,
      newIndex: NEW_INDEX,
      sourceCount: 1,
      indexedCount: 0,
    });
    assert.deepEqual(Object.keys(report).sort(), [
      "indexedCount",
      "newIndex",
      "oldIndex",
      "sourceCount",
    ]);
    await assert.rejects(readFile(join(cwd, ".search-lab", "sync.lock")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
