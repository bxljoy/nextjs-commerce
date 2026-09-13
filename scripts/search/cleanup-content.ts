import { createClient } from "@sanity/client";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildSearchLabPosts,
  type SanitySeedPost,
} from "../../fixtures/search/posts.ts";
import { digestOwnedPost } from "./content-ownership.ts";

const SANITY_API_VERSION = "2024-01-01";
const DELETE_BATCH_SIZE = 20;
const MAX_RECOVERY_REPORT_BYTES = 16 * 1024;
const EXACT_MANIFEST_ID = /^searchLab\.post\.\d{3}$/;

const cleanupCandidatesQuery = `
  *[_id in $lookupIds]{
    _id,
    _type,
    title,
    slug,
    publishedAt,
    excerpt,
    body,
    seo,
    "incomingReferenceIds": *[references(^._id)]._id
  }
`;

export type CleanupObservedDocument = Record<string, unknown> & {
  _id: string;
  incomingReferenceIds: readonly string[];
};

export type CleanupBlock = { id: string; reason: string };

export type CleanupPlan = {
  eligibleIds: string[];
  missingIds: string[];
  blocked: CleanupBlock[];
};

type CleanupTransaction = {
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

type RunSearchContentCleanupDependencies = {
  argv?: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  client?: CleanupClient;
  log?: (message: string) => void;
  readRecoveryReport?: () => Promise<readonly string[]>;
  writeRecoveryReport?: (deletedIds: readonly string[]) => Promise<void>;
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

export function planCleanup(
  expected: readonly SanitySeedPost[],
  observedDocuments: readonly unknown[],
): CleanupPlan {
  const expectedById = new Map<string, SanitySeedPost>();
  for (const post of expected) {
    assertExactManifestId(post._id);
    if (expectedById.has(post._id)) {
      throw new Error(`duplicate manifest ID: ${post._id}`);
    }
    expectedById.set(post._id, post);
  }

  const observedById = new Map<string, unknown>();
  const unexpectedIds: string[] = [];
  for (const [index, document] of observedDocuments.entries()) {
    if (!isRecord(document) || typeof document._id !== "string") {
      unexpectedIds.push(`<malformed-${index + 1}>`);
      continue;
    }
    if (observedById.has(document._id)) {
      throw new Error(`duplicate cleanup observation: ${document._id}`);
    }
    observedById.set(document._id, document);

    const publishedId = document._id.startsWith("drafts.")
      ? document._id.slice("drafts.".length)
      : document._id;
    if (!expectedById.has(publishedId)) unexpectedIds.push(document._id);
  }

  const eligibleIds: string[] = [];
  const missingIds: string[] = [];
  const blocked: CleanupBlock[] = [];

  for (const [id, expectedPost] of expectedById) {
    const published = observedById.get(id);
    const draft = observedById.get(`drafts.${id}`);
    if (!published && !draft) {
      missingIds.push(id);
      continue;
    }
    if (draft) {
      blocked.push({ id, reason: "draft pair exists" });
      continue;
    }
    if (!isRecord(published)) {
      blocked.push({ id, reason: "existing document is malformed" });
      continue;
    }

    let actualDigest: string;
    try {
      actualDigest = digestOwnedPost(published);
    } catch {
      blocked.push({ id, reason: "existing document is malformed" });
      continue;
    }
    if (actualDigest !== digestOwnedPost(expectedPost)) {
      blocked.push({ id, reason: "owned content differs from manifest" });
      continue;
    }

    const incomingReferenceIds = published.incomingReferenceIds;
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

    eligibleIds.push(id);
  }

  for (const id of unexpectedIds) {
    blocked.push({ id, reason: "document is not an exact manifest ID" });
  }

  return { eligibleIds, missingIds, blocked };
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
): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(reportPath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
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
  const expectedKeys = ["dataset", "deletedIds", "projectId"];
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== expectedKeys.join(",") ||
    value.projectId !== config.projectId ||
    value.dataset !== config.dataset ||
    !Array.isArray(value.deletedIds)
  ) {
    throw new Error(
      "search cleanup recovery report is malformed or targets another dataset",
    );
  }

  const allowedIds = new Set(manifestIds);
  if (
    value.deletedIds.length > manifestIds.length ||
    !value.deletedIds.every(
      (id): id is string => typeof id === "string" && allowedIds.has(id),
    ) ||
    new Set(value.deletedIds).size !== value.deletedIds.length
  ) {
    throw new Error("search cleanup recovery report contains invalid IDs");
  }
  return value.deletedIds;
}

async function writeCleanupRecoveryReport(
  reportPath: string,
  config: CleanupConfig,
  deletedIds: readonly string[],
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
          deletedIds,
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
  const client = dependencies.client ?? createCleanupClient(config);

  const readPlan = async (): Promise<CleanupPlan> => {
    const documents = await client.fetch(cleanupCandidatesQuery, {
      ids,
      lookupIds,
    });
    if (!Array.isArray(documents)) {
      throw new TypeError("Sanity cleanup preflight result must be an array");
    }
    return planCleanup(expected, documents);
  };

  const initialPlan = await readPlan();
  log(`Target Sanity project: ${config.projectId}`);
  log(`Target Sanity dataset: ${config.dataset}`);
  logPlan(initialPlan, log);

  if (!options.apply) {
    log("Dry run complete; zero Sanity deletes.");
    return { mode: "dry-run", ...initialPlan, deletedIds: [] };
  }
  if (options.confirmedOwnedCount !== initialPlan.eligibleIds.length) {
    throw new Error("confirmed owned count does not match cleanup eligibility");
  }

  const freshPlan = await readPlan();
  if (
    options.confirmedOwnedCount !== freshPlan.eligibleIds.length ||
    !sameIds(initialPlan.eligibleIds, freshPlan.eligibleIds)
  ) {
    throw new Error(
      "fresh cleanup eligibility changed; rerun dry-run and review",
    );
  }

  const reportPath = join(cwd, ".search-lab", "cleanup-recovery.json");
  const readRecoveryReport =
    dependencies.readRecoveryReport ??
    (() => readCleanupRecoveryReport(reportPath, config, ids));
  const writeRecoveryReport =
    dependencies.writeRecoveryReport ??
    ((deletedIds: readonly string[]) =>
      writeCleanupRecoveryReport(reportPath, config, deletedIds));
  const recordedIds = new Set(await readRecoveryReport());
  const deletedIds: string[] = [];

  for (const batch of batches(freshPlan.eligibleIds, DELETE_BATCH_SIZE)) {
    let transaction = client.transaction();
    for (const id of batch) {
      assertExactManifestId(id);
      transaction = transaction.delete(id);
    }
    await transaction.commit();
    deletedIds.push(...batch);
    for (const id of batch) recordedIds.add(id);
    await writeRecoveryReport(ids.filter((id) => recordedIds.has(id)));
  }

  log(`Deleted: ${deletedIds.length}`);
  return { mode: "apply", ...freshPlan, deletedIds };
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
