import { createClient } from "@sanity/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildSearchLabPosts,
  type SanitySeedPost,
} from "../../fixtures/search/posts.ts";
import { planSeed } from "./content-ownership.ts";

const SANITY_API_VERSION = "2024-01-01";
const EXPECTED_POST_COUNT = 100;
const CREATE_BATCH_SIZE = 20;

const existingSeedCandidatesQuery = `
  *[_id in $ids || (defined(slug.current) && slug.current in $slugs)]{
    _id,
    _type,
    title,
    slug,
    publishedAt,
    excerpt,
    body,
    seo
  }
`;

type SeedTransaction = {
  create(post: SanitySeedPost): SeedTransaction;
  commit(): Promise<unknown>;
};

type SeedClient = {
  fetch(
    query: string,
    parameters: { ids: string[]; slugs: string[] },
  ): Promise<unknown>;
  transaction(): SeedTransaction;
};

type RunSearchSeedDependencies = {
  argv?: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  client?: SeedClient;
  log?: (message: string) => void;
  writeRecoveryReport?: (createdIds: readonly string[]) => Promise<void>;
};

type SeedRunResult = {
  mode: "dry-run" | "apply";
  proposedCount: number;
  createCount: number;
  skippedCount: number;
  conflictIds: string[];
  createdIds: string[];
};

type SeedConfig = {
  projectId: string;
  dataset: string;
  writeToken: string;
};

function readSeedConfig(env: Record<string, string | undefined>): SeedConfig {
  const projectId = env.SANITY_PROJECT_ID;
  const dataset = env.SANITY_DATASET;
  const writeToken = env.SANITY_SEARCH_LAB_WRITE_TOKEN;

  if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) {
    throw new Error("valid SANITY_PROJECT_ID is required for search seed");
  }
  if (!dataset || !/^[a-z0-9_-]+$/.test(dataset)) {
    throw new Error("valid SANITY_DATASET is required for search seed");
  }
  if (!writeToken) {
    throw new Error(
      "dedicated SANITY_SEARCH_LAB_WRITE_TOKEN is required for search seed",
    );
  }

  return { projectId, dataset, writeToken };
}

export function parseSeedOptions(argv: readonly string[]): { apply: boolean } {
  const args = argv.filter((argument) => argument !== "--");
  const known = new Set(["--dry-run", "--apply"]);
  if (
    args.some(
      (argument) =>
        !known.has(argument) && !argument.startsWith("--confirm-count="),
    )
  ) {
    throw new Error("unsupported search seed argument");
  }

  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run");
  const confirmationArguments = args.filter((argument) =>
    argument.startsWith("--confirm-count="),
  );
  const confirmed =
    confirmationArguments.length === 1 &&
    confirmationArguments[0] === "--confirm-count=100";

  if (apply && dryRun) {
    throw new Error("choose either --dry-run or --apply");
  }
  if (confirmationArguments.length > 0 && !apply) {
    throw new Error("--confirm-count=100 requires --apply");
  }
  if (apply && !confirmed) {
    throw new Error("--apply requires --confirm-count=100");
  }

  return { apply };
}

function createSeedClient(config: SeedConfig): SeedClient {
  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: SANITY_API_VERSION,
    perspective: "raw",
    useCdn: false,
    token: config.writeToken,
  }) as unknown as SeedClient;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function runSearchSeed(
  dependencies: RunSearchSeedDependencies = {},
): Promise<SeedRunResult> {
  const argv = dependencies.argv ?? process.argv.slice(2);
  const cwd = dependencies.cwd ?? process.cwd();
  const env = dependencies.env ?? process.env;
  const log = dependencies.log ?? console.log;
  const options = parseSeedOptions(argv);
  const config = readSeedConfig(env);
  const expected = buildSearchLabPosts();

  if (expected.length !== EXPECTED_POST_COUNT) {
    throw new Error("search seed manifest must contain exactly 100 posts");
  }

  const client = dependencies.client ?? createSeedClient(config);
  const ids = expected.map((post) => post._id);
  const slugs = expected.map((post) => post.slug.current);
  const existing = await client.fetch(existingSeedCandidatesQuery, {
    ids,
    slugs,
  });
  if (!Array.isArray(existing)) {
    throw new TypeError("Sanity seed preflight result must be an array");
  }

  const plan = planSeed(expected, existing);
  const conflictIds = plan.conflicts.map((conflict) => conflict.id);
  log(`Target Sanity project: ${config.projectId}`);
  log(`Target Sanity dataset: ${config.dataset}`);
  log(`Proposed: ${expected.length}`);
  log(`Create: ${plan.create.length}`);
  log(`Skip identical: ${plan.skipIdentical.length}`);
  log(`Conflicts: ${conflictIds.length}`);
  for (const id of conflictIds) log(`Conflict ID: ${id}`);

  const baseResult = {
    proposedCount: expected.length,
    createCount: plan.create.length,
    skippedCount: plan.skipIdentical.length,
    conflictIds,
  };

  if (plan.conflicts.length > 0) {
    throw new Error("search seed blocked by preflight conflicts");
  }

  if (!options.apply) {
    log("Dry run complete; zero Sanity writes.");
    return {
      mode: "dry-run",
      ...baseResult,
      createdIds: [],
    };
  }

  const reportPath = join(cwd, ".search-lab", "seed-recovery.json");
  const writeRecoveryReport =
    dependencies.writeRecoveryReport ??
    (async (createdIds: readonly string[]) => {
      await mkdir(join(cwd, ".search-lab"), { recursive: true });
      await writeFile(
        reportPath,
        `${JSON.stringify(
          {
            projectId: config.projectId,
            dataset: config.dataset,
            createdIds,
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
    });

  const createdIds: string[] = [];
  for (const batch of batches(plan.create, CREATE_BATCH_SIZE)) {
    let transaction = client.transaction();
    for (const post of batch) transaction = transaction.create(post);
    await transaction.commit();
    createdIds.push(...batch.map((post) => post._id));
    await writeRecoveryReport(createdIds);
  }

  log(`Created: ${createdIds.length}`);
  return {
    mode: "apply",
    ...baseResult,
    createdIds,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runSearchSeed().catch(() => {
    console.error("Search seed failed.");
    process.exitCode = 1;
  });
}
