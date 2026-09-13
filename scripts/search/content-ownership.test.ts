import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildSearchLabPosts,
  type SanitySeedPost,
} from "../../fixtures/search/posts.ts";
import { digestOwnedPost, planSeed } from "./content-ownership.ts";
import { parseSeedOptions, runSearchSeed } from "./seed.ts";

function fixture(index: number): SanitySeedPost {
  const post = buildSearchLabPosts()[index];
  assert.ok(post);
  return post;
}

function copy(post: SanitySeedPost): SanitySeedPost {
  return structuredClone(post);
}

test("digests fixture-owned content deterministically and ignores system fields", () => {
  const post = fixture(0);
  const withSystemFields = {
    ...copy(post),
    _createdAt: "2026-09-01T00:00:00.000Z",
    _updatedAt: "2026-09-02T00:00:00.000Z",
    _rev: "server-generated",
  };

  assert.match(digestOwnedPost(post), /^[a-f0-9]{64}$/);
  assert.equal(digestOwnedPost(post), digestOwnedPost(withSystemFields));

  const changed = copy(post);
  changed.excerpt = `${changed.excerpt} changed`;
  assert.notEqual(digestOwnedPost(changed), digestOwnedPost(post));
});

test("plans every fixture as create for an empty target", () => {
  const expected = buildSearchLabPosts();
  assert.deepEqual(planSeed(expected, []), {
    create: expected,
    skipIdentical: [],
    conflicts: [],
  });
});

test("skips only identical owned documents on a complete or partial rerun", () => {
  const expected = buildSearchLabPosts();
  const identical = expected.map((post) => ({
    ...copy(post),
    _createdAt: "2026-09-01T00:00:00.000Z",
    _updatedAt: "2026-09-02T00:00:00.000Z",
    _rev: "server-generated",
  }));

  const complete = planSeed(expected, identical);
  assert.equal(complete.create.length, 0);
  assert.deepEqual(
    complete.skipIdentical,
    expected.map((post) => post._id),
  );
  assert.deepEqual(complete.conflicts, []);

  const partial = planSeed(expected, identical.slice(0, 37));
  assert.deepEqual(
    partial.skipIdentical,
    expected.slice(0, 37).map((post) => post._id),
  );
  assert.deepEqual(partial.create, expected.slice(37));
  assert.deepEqual(partial.conflicts, []);
});

test("reports an ID collision instead of authorizing overwrite by prefix", () => {
  const expected = [fixture(0)];
  const conflicting = copy(expected[0]!);
  conflicting.title = "[Search Lab Sample 001] Changed outside the manifest";

  const plan = planSeed(expected, [conflicting]);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.skipIdentical, []);
  assert.deepEqual(plan.conflicts, [
    { id: expected[0]!._id, reason: "owned content differs for proposed ID" },
  ]);
});

test("reports a slug collision with another document", () => {
  const expected = [fixture(0)];
  const conflicting = {
    ...copy(fixture(1)),
    _id: "preexisting-post",
    slug: copy(expected[0]!).slug,
  };

  const plan = planSeed(expected, [conflicting]);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.skipIdentical, []);
  assert.deepEqual(plan.conflicts, [
    {
      id: "preexisting-post",
      reason: `slug collides with ${expected[0]!._id}`,
    },
  ]);
});

test("fails closed for malformed existing documents", () => {
  const expected = [fixture(0)];
  const malformed = {
    _id: expected[0]!._id,
    _type: "post",
    title: expected[0]!.title,
    slug: { _type: "slug", current: expected[0]!.slug.current },
    publishedAt: expected[0]!.publishedAt,
    excerpt: expected[0]!.excerpt,
    body: "not-portable-text",
  };

  const plan = planSeed(expected, [malformed]);
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.skipIdentical, []);
  assert.deepEqual(plan.conflicts, [
    { id: expected[0]!._id, reason: "existing document is malformed" },
  ]);
});

test("requires the exact explicit apply confirmation and defaults to dry-run", () => {
  assert.deepEqual(parseSeedOptions([]), { apply: false });
  assert.deepEqual(parseSeedOptions(["--dry-run"]), { apply: false });
  assert.deepEqual(parseSeedOptions(["--", "--apply", "--confirm-count=100"]), {
    apply: true,
  });

  assert.throws(() => parseSeedOptions(["--apply"]), /confirm-count=100/);
  assert.throws(
    () => parseSeedOptions(["--apply", "--confirm-count=99"]),
    /confirm-count=100/,
  );
  assert.throws(
    () => parseSeedOptions(["--dry-run", "--apply", "--confirm-count=100"]),
    /either --dry-run or --apply/,
  );
  assert.throws(() => parseSeedOptions(["--unknown"]), /unsupported/);
});

test("dry-run reads proposed namespaces and performs zero mutations", async () => {
  let queryParameters: Record<string, unknown> | undefined;
  const logs: string[] = [];
  const result = await runSearchSeed({
    argv: [],
    env: {
      SANITY_PROJECT_ID: "project123",
      SANITY_DATASET: "production",
      SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
    },
    client: {
      async fetch(_query, parameters) {
        queryParameters = parameters;
        return [];
      },
      transaction() {
        throw new Error("dry-run must not create a transaction");
      },
    },
    log: (message) => logs.push(message),
    writeRecoveryReport: async () => {
      throw new Error("dry-run must not write a recovery report");
    },
  });

  assert.deepEqual(result, {
    mode: "dry-run",
    proposedCount: 100,
    createCount: 100,
    skippedCount: 0,
    conflictIds: [],
    createdIds: [],
  });
  assert.equal((queryParameters?.ids as unknown[]).length, 100);
  assert.equal((queryParameters?.slugs as unknown[]).length, 100);
  assert.equal(
    logs.some((message) => message.includes("dedicated-test-token")),
    false,
  );
  assert.equal(
    logs.some((message) => message.includes("paragraph-")),
    false,
  );
});

test("apply creates only missing posts in transactions of twenty", async () => {
  const batchSizes: number[] = [];
  const reportSizes: number[] = [];

  await runSearchSeed({
    argv: ["--apply", "--confirm-count=100"],
    env: {
      SANITY_PROJECT_ID: "project123",
      SANITY_DATASET: "production",
      SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
    },
    client: {
      async fetch() {
        return [];
      },
      transaction() {
        const posts: SanitySeedPost[] = [];
        return {
          create(post) {
            posts.push(post);
            return this;
          },
          async commit() {
            batchSizes.push(posts.length);
          },
        };
      },
    },
    log: () => {},
    readRecoveryReport: async () => [],
    writeRecoveryReport: async (createdIds) => {
      reportSizes.push(createdIds.length);
    },
  });

  assert.deepEqual(batchSizes, [20, 20, 20, 20, 20]);
  assert.deepEqual(reportSizes, [20, 40, 60, 80, 100]);
});

test("apply rejects a recovery report for another target before mutations", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "search-seed-target-"));
  const reportDirectory = join(cwd, ".search-lab");
  await mkdir(reportDirectory);
  await writeFile(
    join(reportDirectory, "seed-recovery.json"),
    JSON.stringify({
      projectId: "another-project",
      dataset: "production",
      createdIds: ["searchLab.post.001"],
    }),
  );

  try {
    await assert.rejects(
      runSearchSeed({
        argv: ["--apply", "--confirm-count=100"],
        cwd,
        env: {
          SANITY_PROJECT_ID: "project123",
          SANITY_DATASET: "production",
          SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
        },
        client: {
          async fetch() {
            return [];
          },
          transaction() {
            throw new Error("must not create a transaction");
          },
        },
        log: () => {},
      }),
      /recovery report target does not match/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a partial-run resume retains every successfully created recovery ID", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "search-seed-resume-"));
  const expected = buildSearchLabPosts();
  const persisted: SanitySeedPost[] = [];
  let failSecondCommit = true;
  let commitCount = 0;

  const client = {
    async fetch() {
      return persisted.map(copy);
    },
    transaction() {
      const posts: SanitySeedPost[] = [];
      return {
        create(post: SanitySeedPost) {
          posts.push(post);
          return this;
        },
        async commit() {
          commitCount += 1;
          if (failSecondCommit && commitCount === 2) {
            throw new Error("simulated second-batch failure");
          }
          persisted.push(...posts.map(copy));
        },
      };
    },
  };
  const dependencies = {
    argv: ["--apply", "--confirm-count=100"],
    cwd,
    env: {
      SANITY_PROJECT_ID: "project123",
      SANITY_DATASET: "production",
      SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
    },
    client,
    log: () => {},
  };

  try {
    await assert.rejects(
      runSearchSeed(dependencies),
      /simulated second-batch failure/,
    );
    assert.deepEqual(
      persisted.map((post) => post._id),
      expected.slice(0, 20).map((post) => post._id),
    );

    failSecondCommit = false;
    commitCount = 0;
    await runSearchSeed(dependencies);

    const report = JSON.parse(
      await readFile(join(cwd, ".search-lab", "seed-recovery.json"), "utf8"),
    ) as { createdIds: string[] };
    assert.deepEqual(
      report.createdIds,
      expected.map((post) => post._id),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
