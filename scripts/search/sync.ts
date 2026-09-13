import { open, mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  requestElasticsearch,
  SearchUnavailableError,
} from "../../lib/search/elasticsearch.ts";
import { readSearchLabConfig } from "./config.ts";
import {
  synchronizePostIndex,
  type IndexerHttpRequest,
  type SynchronizationResult,
} from "./indexer.ts";
import {
  createSearchSanityClient,
  fetchPublishedPostCorpus,
} from "./sanity-source.ts";

const REQUEST_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type SanitySourceClient = {
  fetch: (query: string) => Promise<unknown>;
};

type RunSearchSyncDependencies = {
  argv?: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  sanityClient?: SanitySourceClient;
  http?: (request: IndexerHttpRequest) => Promise<unknown>;
  fetch?: Fetch;
  now?: () => number;
  log?: (message: string) => void;
};

type DryRunResult = {
  mode: "dry-run";
  sourceCount: number;
};

type ApplyResult = SynchronizationResult & { mode: "apply" };

class SyncLockError extends Error {
  constructor() {
    super("search sync lock already exists; stop the other run or inspect it");
    this.name = "SyncLockError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptions(argv: readonly string[]): {
  apply: boolean;
  allowEmpty: boolean;
} {
  const argumentsWithoutSeparator = argv.filter(
    (argument) => argument !== "--",
  );
  const known = new Set(["--dry-run", "--apply", "--allow-empty"]);
  const unknown = argumentsWithoutSeparator.filter(
    (argument) => !known.has(argument),
  );
  if (unknown.length > 0) {
    throw new Error("unsupported search sync argument");
  }

  const apply = argumentsWithoutSeparator.includes("--apply");
  const dryRun = argumentsWithoutSeparator.includes("--dry-run");
  const allowEmpty = argumentsWithoutSeparator.includes("--allow-empty");
  if (apply && dryRun) {
    throw new Error("choose either --dry-run or --apply");
  }
  if (allowEmpty && !apply) {
    throw new Error("--allow-empty requires --apply");
  }

  return { apply, allowEmpty };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.body === null) {
    throw new SearchUnavailableError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The response has already failed closed.
      }
      throw new SearchUnavailableError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) throw new SearchUnavailableError();
    return value;
  } catch (error) {
    if (error instanceof SearchUnavailableError) throw error;
    throw new SearchUnavailableError();
  }
}

function createSyncHttp(baseUrl: string, fetch: Fetch) {
  return async (request: IndexerHttpRequest): Promise<unknown> => {
    if (request.contentType === "application/x-ndjson") {
      try {
        const url = new URL(request.path, baseUrl);
        if (url.origin !== new URL(baseUrl).origin) {
          throw new SearchUnavailableError();
        }
        const response = await fetch(url, {
          method: request.method,
          cache: "no-store",
          headers: { "content-type": "application/x-ndjson" },
          body: request.body as BodyInit,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return await readBoundedJson(response);
      } catch (error) {
        if (error instanceof SearchUnavailableError) throw error;
        throw new SearchUnavailableError();
      }
    }

    const value = await requestElasticsearch({
      baseUrl,
      path: request.path,
      method: request.method,
      body: request.body,
      acceptedStatuses: request.acceptedStatuses,
      fetch,
      isResponse: isRecord,
    });

    if (
      request.acceptedStatuses?.includes(404) &&
      isRecord(value) &&
      value.status === 404
    ) {
      return {};
    }
    return value;
  };
}

export async function runSearchSync(
  dependencies: RunSearchSyncDependencies = {},
): Promise<DryRunResult | ApplyResult> {
  const argv = dependencies.argv ?? process.argv.slice(2);
  const cwd = dependencies.cwd ?? process.cwd();
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? console.log;
  const options = parseOptions(argv);
  const reportDirectory = join(cwd, ".search-lab");
  const lockPath = join(reportDirectory, "sync.lock");

  await mkdir(reportDirectory, { recursive: true });
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      throw new SyncLockError();
    }
    throw error;
  }

  try {
    const config = readSearchLabConfig(env);
    const client = dependencies.sanityClient ?? createSearchSanityClient(env);
    const documents = await fetchPublishedPostCorpus(client);

    if (!options.apply) {
      log(
        `Dry run: validated ${documents.length} published posts; no index changes.`,
      );
      return { mode: "dry-run", sourceCount: documents.length };
    }

    const http =
      dependencies.http ??
      createSyncHttp(config.elasticsearchUrl, dependencies.fetch ?? fetch);
    const result = await synchronizePostIndex({
      alias: config.indexAlias,
      documents,
      http,
      now,
      allowEmpty: options.allowEmpty,
      writeRecoveryReport: async (report) => {
        await writeFile(
          join(reportDirectory, "sync-recovery.json"),
          `${JSON.stringify(report, null, 2)}\n`,
          { mode: 0o600 },
        );
      },
    });
    log(
      `Synchronized ${result.indexedCount} published posts into ${result.newIndex}.`,
    );
    return { mode: "apply", ...result };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runSearchSync().catch((error: unknown) => {
    console.error(
      error instanceof SyncLockError ? error.message : "Search sync failed.",
    );
    process.exitCode = 1;
  });
}
