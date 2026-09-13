import { createClient } from "@sanity/client";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  buildSearchLabPosts,
  type SanitySeedPost,
} from "../../fixtures/search/posts.ts";
import { readSeedRecoveryReport } from "./seed.ts";

const SANITY_API_VERSION = "2024-01-01";
const DELETE_BATCH_SIZE = 20;
const MAX_RECOVERY_REPORT_BYTES = 16 * 1024;
const EXACT_MANIFEST_ID = /^search-lab-post-\d{3}$/;
const SANITY_SYSTEM_DOCUMENT_FIELDS = new Set([
  "_createdAt",
  "_rev",
  "_system",
  "_updatedAt",
]);

const cleanupCandidatesQuery = `
  *[_id in $lookupIds]{
    "document": @,
    "incomingReferenceIds": *[references(^._id)]._id
  }
`;

export type CleanupObservedDocument = {
  document: Record<string, unknown> & { _id: string };
  incomingReferenceIds: readonly string[];
};

export type CleanupBlock = { id: string; reason: string };

export type CleanupPlan = {
  eligibleIds: string[];
  missingIds: string[];
  blocked: CleanupBlock[];
};

type CleanupRevisionPatch = {
  ifRevisionId(revision: string): CleanupRevisionPatch;
  unset(paths: string[]): CleanupRevisionPatch;
};

type CleanupTransaction = {
  patch(
    id: string,
    build: (patch: CleanupRevisionPatch) => CleanupRevisionPatch,
  ): CleanupTransaction;
  delete(id: string): CleanupTransaction;
  commit(): Promise<unknown>;
};

type CleanupClient = {
  fetch(
    query: string,
    parameters: { ids: string[]; lookupIds: string[] },
  ): Promise<unknown>;
  transaction(): CleanupTransaction;
};

type CleanupConfig = {
  projectId: string;
  dataset: string;
  writeToken: string;
};

export type CleanupRecoveryState = {
  completedIds: string[];
  pendingBatch: { id: string; revision: string }[] | null;
};

type RunSearchContentCleanupDependencies = {
  argv?: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  client?: CleanupClient;
  log?: (message: string) => void;
  readSeedRecoveryReport?: () => Promise<readonly string[]>;
  readRecoveryReport?: () => Promise<CleanupRecoveryState>;
  writeRecoveryReport?: (state: CleanupRecoveryState) => Promise<void>;
};

type CleanupRunResult = CleanupPlan & {
  mode: "dry-run" | "apply";
  deletedIds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactManifestId(id: string): void {
  if (!EXACT_MANIFEST_ID.test(id)) {
    throw new Error(`expected an exact search lab manifest ID: ${id}`);
  }
}

function readCleanupConfig(
  env: Record<string, string | undefined>,
): CleanupConfig {
  const projectId = env.SANITY_PROJECT_ID;
  const dataset = env.SANITY_DATASET;
  const writeToken = env.SANITY_SEARCH_LAB_WRITE_TOKEN;

  if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) {
    throw new Error("valid SANITY_PROJECT_ID is required for search cleanup");
  }
  if (!dataset || !/^[a-z0-9_-]+$/.test(dataset)) {
    throw new Error("valid SANITY_DATASET is required for search cleanup");
  }
  if (!writeToken) {
    throw new Error(
      "dedicated SANITY_SEARCH_LAB_WRITE_TOKEN is required for search cleanup",
    );
  }

  return { projectId, dataset, writeToken };
}

export function parseCleanupOptions(
  argv: readonly string[],
): { apply: false } | { apply: true; confirmedOwnedCount: number } {
  const args = argv.filter((argument) => argument !== "--");
  const confirmationPrefix = "--confirm-owned-count=";
  if (
    args.some(
      (argument) =>
        argument !== "--dry-run" &&
        argument !== "--apply" &&
        !argument.startsWith(confirmationPrefix),
    )
  ) {
    throw new Error("unsupported search cleanup argument");
  }

  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run");
  const confirmations = args.filter((argument) =>
    argument.startsWith(confirmationPrefix),
  );

  if (apply && dryRun) {
    throw new Error("choose either --dry-run or --apply");
  }
  if (confirmations.length > 0 && !apply) {
    throw new Error("--confirm-owned-count requires --apply");
  }
  if (!apply) return { apply: false };
  if (confirmations.length !== 1) {
    throw new Error("--apply requires exactly one --confirm-owned-count");
  }

  const countText = confirmations[0]!.slice(confirmationPrefix.length);
  if (!/^(0|[1-9]\d*)$/.test(countText)) {
    throw new Error("--confirm-owned-count must be a non-negative integer");
  }
  const confirmedOwnedCount = Number(countText);
  if (!Number.isSafeInteger(confirmedOwnedCount)) {
    throw new Error("--confirm-owned-count must be a non-negative integer");
  }

  return { apply: true, confirmedOwnedCount };
}

type PlannedCleanup = {
  plan: CleanupPlan;
  revisionsById: ReadonlyMap<string, string>;
};

function buildCleanupPlan(
  expected: readonly SanitySeedPost[],
  observedDocuments: readonly unknown[],
  labCreatedIds: readonly string[],
): PlannedCleanup {
  const expectedById = new Map<string, SanitySeedPost>();
  for (const post of expected) {
    assertExactManifestId(post._id);
    if (expectedById.has(post._id)) {
      throw new Error(`duplicate manifest ID: ${post._id}`);
    }
    expectedById.set(post._id, post);
  }

  const labCreatedIdSet = new Set<string>();
  for (const id of labCreatedIds) {
    assertExactManifestId(id);
    if (!expectedById.has(id)) {
      throw new Error(`lab-created ID is not in the manifest: ${id}`);
    }
    if (labCreatedIdSet.has(id)) {
      throw new Error(`duplicate lab-created ID: ${id}`);
    }
    labCreatedIdSet.add(id);
  }

  const observedById = new Map<string, CleanupObservedDocument>();
  const unexpectedIds: string[] = [];
  for (const [index, candidate] of observedDocuments.entries()) {
    if (
      !isRecord(candidate) ||
      !isRecord(candidate.document) ||
      typeof candidate.document._id !== "string"
    ) {
      unexpectedIds.push(`<malformed-${index + 1}>`);
      continue;
    }
    const documentId = candidate.document._id;
    if (observedById.has(documentId)) {
      throw new Error(`duplicate cleanup observation: ${documentId}`);
    }
    observedById.set(documentId, candidate as CleanupObservedDocument);

    const publishedId = documentId.startsWith("drafts.")
      ? documentId.slice("drafts.".length)
      : documentId;
    if (!expectedById.has(publishedId)) unexpectedIds.push(documentId);
  }

  const eligibleIds: string[] = [];
  const missingIds: string[] = [];
  const blocked: CleanupBlock[] = [];
  const revisionsById = new Map<string, string>();

  for (const [id, expectedPost] of expectedById) {
    const publishedCandidate = observedById.get(id);
    const draftCandidate = observedById.get(`drafts.${id}`);
    if (!publishedCandidate && !draftCandidate) {
      missingIds.push(id);
      continue;
    }
    if (!labCreatedIdSet.has(id)) {
      blocked.push({
        id,
        reason: "document is not recorded as created by this search lab",
      });
      continue;
    }
    if (draftCandidate) {
      blocked.push({ id, reason: "draft pair exists" });
      continue;
    }
    if (!publishedCandidate) {
      blocked.push({ id, reason: "existing document is malformed" });
      continue;
    }

    const published = publishedCandidate.document;
    const expectedFieldNames = new Set(Object.keys(expectedPost));
    const contentEntries = Object.entries(published).filter(
      ([fieldName]) => !SANITY_SYSTEM_DOCUMENT_FIELDS.has(fieldName),
    );
    const unexpectedFieldNames = contentEntries
      .map(([fieldName]) => fieldName)
      .filter((fieldName) => !expectedFieldNames.has(fieldName))
      .sort();
    if (unexpectedFieldNames.length > 0) {
      blocked.push({
        id,
        reason: `document has non-manifest content fields: ${unexpectedFieldNames.join(", ")}`,
      });
      continue;
    }

    if (!isDeepStrictEqual(Object.fromEntries(contentEntries), expectedPost)) {
      blocked.push({ id, reason: "owned content differs from manifest" });
      continue;
    }

    const incomingReferenceIds = publishedCandidate.incomingReferenceIds;
    if (
      !Array.isArray(incomingReferenceIds) ||
      !incomingReferenceIds.every(
        (referenceId) => typeof referenceId === "string",
      )
    ) {
      blocked.push({ id, reason: "incoming reference result is malformed" });
      continue;
    }
    if (incomingReferenceIds.length > 0) {
      blocked.push({
        id,
        reason: `document has incoming references: ${incomingReferenceIds.join(", ")}`,
      });
      continue;
    }
    if (typeof published._rev !== "string" || published._rev.trim() === "") {
      blocked.push({ id, reason: "document revision is malformed" });
      continue;
    }

    eligibleIds.push(id);
    revisionsById.set(id, published._rev);
  }

  for (const id of unexpectedIds) {
    blocked.push({ id, reason: "document is not an exact manifest ID" });
  }

  return {
    plan: { eligibleIds, missingIds, blocked },
    revisionsById,
  };
}

export function planCleanup(
  expected: readonly SanitySeedPost[],
  observedDocuments: readonly unknown[],
  labCreatedIds: readonly string[] = [],
): CleanupPlan {
  return buildCleanupPlan(expected, observedDocuments, labCreatedIds).plan;
}

function createCleanupClient(config: CleanupConfig): CleanupClient {
  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: SANITY_API_VERSION,
    perspective: "raw",
    useCdn: false,
    token: config.writeToken,
  }) as unknown as CleanupClient;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

async function readCleanupRecoveryReport(
  reportPath: string,
  config: CleanupConfig,
  manifestIds: readonly string[],
): Promise<CleanupRecoveryState> {
  let text: string;
  try {
    text = await readFile(reportPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return { completedIds: [], pendingBatch: null };
    }
    throw error;
  }
  if (Buffer.byteLength(text) > MAX_RECOVERY_REPORT_BYTES) {
    throw new Error("search cleanup recovery report is too large");
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("search cleanup recovery report is malformed");
  }
  const expectedKeys = ["completedIds", "dataset", "pendingBatch", "projectId"];
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== expectedKeys.join(",") ||
    value.projectId !== config.projectId ||
    value.dataset !== config.dataset ||
    !Array.isArray(value.completedIds) ||
    !(value.pendingBatch === null || Array.isArray(value.pendingBatch))
  ) {
    throw new Error(
      "search cleanup recovery report is malformed or targets another dataset",
    );
  }

  const allowedIds = new Set(manifestIds);
  const completedIds = value.completedIds;
  if (
    completedIds.length > manifestIds.length ||
    !completedIds.every(
      (id): id is string => typeof id === "string" && allowedIds.has(id),
    ) ||
    new Set(completedIds).size !== completedIds.length
  ) {
    throw new Error("search cleanup recovery report contains invalid IDs");
  }

  const pendingBatch = value.pendingBatch;
  if (
    pendingBatch !== null &&
    (pendingBatch.length === 0 ||
      pendingBatch.length > DELETE_BATCH_SIZE ||
      !pendingBatch.every(
        (entry): entry is { id: string; revision: string } =>
          isRecord(entry) &&
          Object.keys(entry).sort().join(",") === "id,revision" &&
          typeof entry.id === "string" &&
          allowedIds.has(entry.id) &&
          typeof entry.revision === "string" &&
          entry.revision.trim() !== "",
      ) ||
      new Set(pendingBatch.map((entry) => entry.id)).size !==
        pendingBatch.length ||
      pendingBatch.some((entry) => completedIds.includes(entry.id)))
  ) {
    throw new Error(
      "search cleanup recovery report contains invalid pending IDs",
    );
  }

  return {
    completedIds: [...completedIds],
    pendingBatch:
      pendingBatch === null
        ? null
        : pendingBatch.map((entry) => ({
            id: entry.id,
            revision: entry.revision,
          })),
  };
}

async function writeCleanupRecoveryReport(
  reportPath: string,
  config: CleanupConfig,
  state: CleanupRecoveryState,
): Promise<void> {
  const reportDirectory = dirname(reportPath);
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${reportPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(
        {
          projectId: config.projectId,
          dataset: config.dataset,
          completedIds: state.completedIds,
          pendingBatch: state.pendingBatch,
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporaryPath, reportPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function logPlan(plan: CleanupPlan, log: (message: string) => void): void {
  log(`Eligible: ${plan.eligibleIds.length}`);
  for (const id of plan.eligibleIds) log(`Eligible ID: ${id}`);
  log(`Missing: ${plan.missingIds.length}`);
  for (const id of plan.missingIds) log(`Missing ID: ${id}`);
  log(`Blocked: ${plan.blocked.length}`);
  for (const item of plan.blocked)
    log(`Blocked ID: ${item.id} (${item.reason})`);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

export async function runSearchContentCleanup(
  dependencies: RunSearchContentCleanupDependencies = {},
): Promise<CleanupRunResult> {
  const argv = dependencies.argv ?? process.argv.slice(2);
  const cwd = dependencies.cwd ?? process.cwd();
  const env = dependencies.env ?? process.env;
  const log = dependencies.log ?? console.log;
  const options = parseCleanupOptions(argv);
  const config = readCleanupConfig(env);
  const expected = buildSearchLabPosts();
  const ids = expected.map((post) => post._id);
  const lookupIds = [...ids, ...ids.map((id) => `drafts.${id}`)];
  const seedReportPath = join(cwd, ".search-lab", "seed-recovery.json");
  const cleanupReportPath = join(cwd, ".search-lab", "cleanup-recovery.json");
  const readSeedReport =
    dependencies.readSeedRecoveryReport ??
    (() => readSeedRecoveryReport(seedReportPath, config, ids));
  const readRecoveryReport =
    dependencies.readRecoveryReport ??
    (() => readCleanupRecoveryReport(cleanupReportPath, config, ids));
  const writeRecoveryReport =
    dependencies.writeRecoveryReport ??
    ((state: CleanupRecoveryState) =>
      writeCleanupRecoveryReport(cleanupReportPath, config, state));

  const seedCreatedIds = await readSeedReport();
  let recoveryState = await readRecoveryReport();
  const completedIdSet = new Set(recoveryState.completedIds);
  const deletableOwnedIds = seedCreatedIds.filter(
    (id) => !completedIdSet.has(id),
  );
  const client = dependencies.client ?? createCleanupClient(config);

  const readPlan = async (): Promise<PlannedCleanup> => {
    const documents = await client.fetch(cleanupCandidatesQuery, {
      ids,
      lookupIds,
    });
    if (!Array.isArray(documents)) {
      throw new TypeError("Sanity cleanup preflight result must be an array");
    }
    return buildCleanupPlan(expected, documents, deletableOwnedIds);
  };

  const initial = await readPlan();
  log(`Target Sanity project: ${config.projectId}`);
  log(`Target Sanity dataset: ${config.dataset}`);
  logPlan(initial.plan, log);

  if (!options.apply) {
    log("Dry run complete; zero Sanity deletes.");
    return { mode: "dry-run", ...initial.plan, deletedIds: [] };
  }
  if (options.confirmedOwnedCount !== initial.plan.eligibleIds.length) {
    throw new Error("confirmed owned count does not match cleanup eligibility");
  }

  const fresh = await readPlan();
  if (
    options.confirmedOwnedCount !== fresh.plan.eligibleIds.length ||
    !sameIds(initial.plan.eligibleIds, fresh.plan.eligibleIds)
  ) {
    throw new Error(
      "fresh cleanup eligibility changed; rerun dry-run and review",
    );
  }

  let pendingRetry: { id: string; revision: string }[] | null = null;
  if (recoveryState.pendingBatch !== null) {
    const pendingIds = recoveryState.pendingBatch.map((entry) => entry.id);
    const missingIds = new Set(fresh.plan.missingIds);
    const eligibleIds = new Set(fresh.plan.eligibleIds);
    const allMissing = pendingIds.every((id) => missingIds.has(id));
    const allRetryable = recoveryState.pendingBatch.every(
      (entry) =>
        eligibleIds.has(entry.id) &&
        fresh.revisionsById.get(entry.id) === entry.revision,
    );

    if (allMissing) {
      const reconciledIds = new Set([
        ...recoveryState.completedIds,
        ...pendingIds,
      ]);
      recoveryState = {
        completedIds: ids.filter((id) => reconciledIds.has(id)),
        pendingBatch: null,
      };
      await writeRecoveryReport(recoveryState);
    } else if (allRetryable) {
      pendingRetry = recoveryState.pendingBatch;
    } else {
      throw new Error(
        "pending cleanup batch cannot be reconciled safely; inspect without deleting",
      );
    }
  }

  const pendingIds = new Set(pendingRetry?.map((entry) => entry.id) ?? []);
  const remainingIds = fresh.plan.eligibleIds.filter(
    (id) => !pendingIds.has(id),
  );
  const workBatches = [
    ...(pendingRetry === null ? [] : [pendingRetry.map((entry) => entry.id)]),
    ...batches(remainingIds, DELETE_BATCH_SIZE),
  ];
  const deletedIds: string[] = [];

  for (const batch of workBatches) {
    const pendingBatch = batch.map((id) => {
      const revision = fresh.revisionsById.get(id);
      if (revision === undefined) {
        throw new Error(`eligible cleanup document has no revision: ${id}`);
      }
      return { id, revision };
    });
    recoveryState = {
      completedIds: [...recoveryState.completedIds],
      pendingBatch,
    };
    await writeRecoveryReport(recoveryState);

    let transaction = client.transaction();
    for (const { id, revision } of pendingBatch) {
      assertExactManifestId(id);
      transaction = transaction.patch(id, (patch) =>
        patch.ifRevisionId(revision).unset(["__searchLabCleanupRevisionGuard"]),
      );
      transaction = transaction.delete(id);
    }
    await transaction.commit();
    deletedIds.push(...batch);
    const completedIds = new Set([...recoveryState.completedIds, ...batch]);
    recoveryState = {
      completedIds: ids.filter((id) => completedIds.has(id)),
      pendingBatch: null,
    };
    await writeRecoveryReport(recoveryState);
  }

  log(`Deleted: ${deletedIds.length}`);
  return { mode: "apply", ...fresh.plan, deletedIds };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runSearchContentCleanup().catch(() => {
    console.error("Search content cleanup failed.");
    process.exitCode = 1;
  });
}
