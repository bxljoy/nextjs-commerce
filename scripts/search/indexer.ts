import type { SearchPostDocument } from "../../lib/search/contracts.ts";
import { POST_INDEX_MAPPING } from "../../lib/search/mapping.ts";
import { assertSafeLabIndexName } from "./config.ts";

const BULK_BATCH_SIZE = 100;

export type IndexerHttpRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  contentType?: "application/json" | "application/x-ndjson";
  acceptedStatuses?: readonly number[];
};

export type SynchronizationRecoveryReport = {
  oldIndex: string | null;
  newIndex: string;
  sourceCount: number;
  indexedCount: number;
};

type SynchronizeDependencies = {
  alias: string;
  documents: readonly SearchPostDocument[];
  http: (request: IndexerHttpRequest) => Promise<unknown>;
  now: () => number;
  allowEmpty?: boolean;
  writeRecoveryReport?: (
    report: SynchronizationRecoveryReport,
  ) => Promise<void> | void;
};

export type SynchronizationResult = SynchronizationRecoveryReport;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireAcknowledged(value: unknown, operation: string): void {
  if (!isRecord(value) || value.acknowledged !== true) {
    throw new Error(`${operation} was not acknowledged`);
  }
}

function readExactCount(value: unknown): number {
  if (
    !isRecord(value) ||
    typeof value.count !== "number" ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0
  ) {
    throw new Error("Elasticsearch count response is malformed");
  }
  return value.count;
}

function readAliasTarget(value: unknown, alias: string): string | null {
  if (!isRecord(value)) {
    throw new Error("Elasticsearch alias response is malformed");
  }

  const targets = Object.keys(value);
  if (targets.length > 1) {
    throw new Error("search alias unexpectedly targets multiple indices");
  }
  const target = targets[0];
  if (target === undefined) {
    return null;
  }

  assertSafeLabIndexName(target);
  const metadata = value[target];
  if (
    !isRecord(metadata) ||
    !isRecord(metadata.aliases) ||
    !Object.hasOwn(metadata.aliases, alias)
  ) {
    throw new Error("Elasticsearch alias response is malformed");
  }
  return target;
}

function validateUniqueDocuments(
  documents: readonly SearchPostDocument[],
): void {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.id) || slugs.has(document.slug)) {
      throw new Error("source documents must have unique IDs and slugs");
    }
    ids.add(document.id);
    slugs.add(document.slug);
  }
}

function inspectBulkResponse(
  value: unknown,
  expectedDocuments: readonly SearchPostDocument[],
): void {
  let failed = !isRecord(value) || value.errors !== false;
  const items =
    isRecord(value) && Array.isArray(value.items) ? value.items : [];
  if (items.length !== expectedDocuments.length) {
    failed = true;
  }

  const inspectedCount = Math.max(items.length, expectedDocuments.length);
  for (let index = 0; index < inspectedCount; index += 1) {
    const item = items[index];
    const expected = expectedDocuments[index];
    const result = isRecord(item) && isRecord(item.index) ? item.index : null;
    const status = result?.status;
    const id = result?._id;

    if (
      expected === undefined ||
      typeof status !== "number" ||
      status < 200 ||
      status >= 300 ||
      id !== expected.id ||
      Object.hasOwn(result ?? {}, "error")
    ) {
      failed = true;
    }
  }

  if (failed) {
    throw new Error("Elasticsearch bulk indexing failed");
  }
}

function readIndexedIds(value: unknown, expectedCount: number): string[] {
  if (!isRecord(value) || !isRecord(value.hits)) {
    throw new Error("Elasticsearch ID validation response is malformed");
  }
  const total = value.hits.total;
  const hits = value.hits.hits;
  if (
    !isRecord(total) ||
    total.value !== expectedCount ||
    total.relation !== "eq" ||
    !Array.isArray(hits)
  ) {
    throw new Error("Elasticsearch ID validation failed");
  }

  const ids: string[] = [];
  for (const hit of hits) {
    if (!isRecord(hit) || typeof hit._id !== "string") {
      throw new Error("Elasticsearch ID validation response is malformed");
    }
    ids.push(hit._id);
  }
  return ids;
}

function validateCompleteIdSet(
  value: unknown,
  documents: readonly SearchPostDocument[],
): void {
  const actualIds = readIndexedIds(value, documents.length);
  const expectedIds = new Set(documents.map(({ id }) => id));
  const actualIdSet = new Set(actualIds);
  if (
    actualIds.length !== documents.length ||
    actualIdSet.size !== documents.length ||
    [...expectedIds].some((id) => !actualIdSet.has(id))
  ) {
    throw new Error("Elasticsearch ID validation failed");
  }
}

export function buildBulkBody(
  documents: readonly SearchPostDocument[],
): string {
  return documents
    .flatMap((document) => [
      JSON.stringify({ index: { _id: document.id } }),
      JSON.stringify(document),
    ])
    .join("\n")
    .concat(documents.length === 0 ? "" : "\n");
}

export async function synchronizePostIndex(
  dependencies: SynchronizeDependencies,
): Promise<SynchronizationResult> {
  const { alias, documents, http, now } = dependencies;
  assertSafeLabIndexName(alias);
  validateUniqueDocuments(documents);

  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || String(timestamp).length !== 13) {
    throw new Error("sync clock must return a 13-digit millisecond timestamp");
  }
  const newIndex = `${alias}-v${timestamp}`;
  assertSafeLabIndexName(newIndex);

  const aliasResponse = await http({
    method: "GET",
    path: `/_alias/${alias}`,
    acceptedStatuses: [404],
  });
  const oldIndex = readAliasTarget(aliasResponse, alias);

  if (documents.length === 0 && oldIndex !== null) {
    const oldCount = readExactCount(
      await http({ method: "GET", path: `/${oldIndex}/_count` }),
    );
    if (oldCount > 0 && dependencies.allowEmpty !== true) {
      throw new Error(
        "empty source cannot replace a nonempty index without allowEmpty",
      );
    }
  }

  let created = false;
  let indexedCount = 0;
  let promotionAttempted = false;
  try {
    const createResponse = await http({
      method: "PUT",
      path: `/${newIndex}`,
      body: POST_INDEX_MAPPING,
      contentType: "application/json",
    });
    created = true;
    requireAcknowledged(createResponse, "index creation");

    for (let offset = 0; offset < documents.length; offset += BULK_BATCH_SIZE) {
      const batch = documents.slice(offset, offset + BULK_BATCH_SIZE);
      const bulkResponse = await http({
        method: "POST",
        path: `/${newIndex}/_bulk`,
        body: buildBulkBody(batch),
        contentType: "application/x-ndjson",
      });
      inspectBulkResponse(bulkResponse, batch);
      indexedCount += batch.length;
    }

    await http({ method: "POST", path: `/${newIndex}/_refresh` });

    indexedCount = readExactCount(
      await http({ method: "GET", path: `/${newIndex}/_count` }),
    );
    if (indexedCount !== documents.length) {
      throw new Error("Elasticsearch count validation failed");
    }

    const idResponse = await http({
      method: "POST",
      path: `/${newIndex}/_search`,
      body: {
        size: documents.length,
        query: { match_all: {} },
        _source: false,
        sort: [{ id: "asc" }],
        track_total_hits: true,
      },
      contentType: "application/json",
    });
    validateCompleteIdSet(idResponse, documents);

    promotionAttempted = true;
    const aliasResponse = await http({
      method: "POST",
      path: "/_aliases",
      body: {
        actions: [
          ...(oldIndex ? [{ remove: { index: oldIndex, alias } }] : []),
          { add: { index: newIndex, alias, is_write_index: false } },
        ],
      },
      contentType: "application/json",
    });
    requireAcknowledged(aliasResponse, "alias promotion");

    return {
      oldIndex,
      newIndex,
      sourceCount: documents.length,
      indexedCount,
    };
  } catch (error) {
    if (created) {
      const report = {
        oldIndex,
        newIndex,
        sourceCount: documents.length,
        indexedCount,
      };
      let cleanupIsSafe = !promotionAttempted;

      if (promotionAttempted) {
        try {
          const observedTarget = readAliasTarget(
            await http({
              method: "GET",
              path: `/_alias/${alias}`,
              acceptedStatuses: [404],
            }),
            alias,
          );
          if (observedTarget === newIndex) {
            return report;
          }
          cleanupIsSafe = observedTarget === oldIndex;
        } catch {
          // Retain the new index when promotion state cannot be established.
          cleanupIsSafe = false;
        }
      }

      try {
        await dependencies.writeRecoveryReport?.(report);
      } catch {
        // Recovery reporting must not prevent bounded cleanup.
      }
      if (cleanupIsSafe) {
        try {
          await http({
            method: "DELETE",
            path: `/${newIndex}`,
            acceptedStatuses: [404],
          });
        } catch {
          // Preserve the original synchronization failure for diagnosis.
        }
      }
    }
    throw error;
  }
}
