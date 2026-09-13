import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildSearchLabPosts,
  type SanitySeedPost,
} from "../../fixtures/search/posts.ts";
import {
  parseCleanupOptions,
  planCleanup,
  runSearchContentCleanup,
  type CleanupObservedDocument,
} from "./cleanup-content.ts";

function fixture(index: number): SanitySeedPost {
  const post = buildSearchLabPosts()[index];
  assert.ok(post);
  return structuredClone(post);
}

function observed(
  post: SanitySeedPost,
  incomingReferenceIds: readonly string[] = [],
): CleanupObservedDocument {
  return { ...structuredClone(post), incomingReferenceIds };
}

test("plans only exact, unchanged, unreferenced manifest documents as eligible", () => {
  const expected = [fixture(0), fixture(1)];

  assert.deepEqual(planCleanup(expected, [observed(expected[0]!)]), {
    eligibleIds: [expected[0]!._id],
    missingIds: [expected[1]!._id],
    blocked: [],
  });
});

test("blocks changed, unexpected, draft-paired, and referenced documents", () => {
  const expected = [fixture(0), fixture(1), fixture(2)];
  const changed = observed(expected[0]!);
  changed.title = `${changed.title} changed`;
  const draft = {
    ...observed(expected[1]!),
    _id: `drafts.${expected[1]!._id}`,
  };
  const referenced = observed(expected[2]!, ["preexisting.author"]);
  const unexpected = observed(fixture(3));
  unexpected._id = "searchLab.post.999";

  assert.deepEqual(
    planCleanup(expected, [changed, draft, referenced, unexpected]),
    {
      eligibleIds: [],
      missingIds: [],
      blocked: [
        {
          id: expected[0]!._id,
          reason: "owned content differs from manifest",
        },
        { id: expected[1]!._id, reason: "draft pair exists" },
        {
          id: expected[2]!._id,
          reason: "document has incoming references: preexisting.author",
        },
        {
          id: "searchLab.post.999",
          reason: "document is not an exact manifest ID",
        },
      ],
    },
  );
});

test("a draft pair blocks an otherwise identical published document", () => {
  const expected = [fixture(0)];
  const published = observed(expected[0]!);
  const draft = {
    ...observed(expected[0]!),
    _id: `drafts.${expected[0]!._id}`,
  };

  assert.deepEqual(planCleanup(expected, [published, draft]), {
    eligibleIds: [],
    missingIds: [],
    blocked: [{ id: expected[0]!._id, reason: "draft pair exists" }],
  });
});

test("rejects prefix-only, wildcard, duplicate, and noncanonical manifest IDs", () => {
  const valid = fixture(0);
  const invalidIds = [
    "searchLab.post.",
    "searchLab.post.*",
    "searchLab.post.1",
    "drafts.searchLab.post.001",
  ];

  for (const id of invalidIds) {
    assert.throws(
      () => planCleanup([{ ...valid, _id: id }], []),
      /exact search lab manifest ID/,
    );
  }
  assert.throws(
    () => planCleanup([valid, structuredClone(valid)], []),
    /duplicate/,
  );
});

test("requires a separate exact apply confirmation and defaults to dry-run", () => {
  assert.deepEqual(parseCleanupOptions([]), { apply: false });
  assert.deepEqual(parseCleanupOptions(["--dry-run"]), { apply: false });
  assert.deepEqual(
    parseCleanupOptions(["--", "--apply", "--confirm-owned-count=37"]),
    { apply: true, confirmedOwnedCount: 37 },
  );

  assert.throws(() => parseCleanupOptions(["--apply"]), /confirm-owned-count/);
  assert.throws(
    () => parseCleanupOptions(["--apply", "--confirm-owned-count=037"]),
    /non-negative integer/,
  );
  assert.throws(
    () => parseCleanupOptions(["--dry-run", "--confirm-owned-count=1"]),
    /requires --apply/,
  );
  assert.throws(
    () =>
      parseCleanupOptions(["--dry-run", "--apply", "--confirm-owned-count=1"]),
    /either --dry-run or --apply/,
  );
  assert.throws(() => parseCleanupOptions(["--unknown"]), /unsupported/);
});

test("dry-run reports counts and IDs while performing zero mutations", async () => {
  const expected = buildSearchLabPosts();
  const changed = observed(expected[1]!);
  changed.excerpt = `${changed.excerpt} changed`;
  const logs: string[] = [];
  let fetchCount = 0;

  const result = await runSearchContentCleanup({
    argv: [],
    env: {
      SANITY_PROJECT_ID: "project123",
      SANITY_DATASET: "production",
      SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
    },
    client: {
      async fetch(_query, parameters) {
        fetchCount += 1;
        assert.equal(parameters.ids.length, 100);
        assert.equal(parameters.lookupIds.length, 200);
        return [observed(expected[0]!), changed];
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

  assert.equal(fetchCount, 1);
  assert.deepEqual(result, {
    mode: "dry-run",
    eligibleIds: [expected[0]!._id],
    missingIds: expected.slice(2).map((post) => post._id),
    blocked: [
      {
        id: expected[1]!._id,
        reason: "owned content differs from manifest",
      },
    ],
    deletedIds: [],
  });
  assert.ok(logs.includes("Eligible: 1"));
  assert.ok(logs.includes(`Eligible ID: ${expected[0]!._id}`));
  assert.ok(logs.includes("Missing: 98"));
  assert.ok(logs.includes("Blocked: 1"));
  assert.equal(
    logs.some((message) => message.includes("dedicated-test-token")),
    false,
  );
  assert.equal(
    logs.some((message) => message.includes("paragraph-")),
    false,
  );
});

test("apply performs a fresh read and deletes explicit eligible IDs in bounded transactions", async () => {
  const expected = buildSearchLabPosts();
  let fetchCount = 0;
  const deletedBatches: string[][] = [];
  const reportSizes: number[] = [];

  const result = await runSearchContentCleanup({
    argv: ["--apply", "--confirm-owned-count=41"],
    env: {
      SANITY_PROJECT_ID: "project123",
      SANITY_DATASET: "production",
      SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
    },
    client: {
      async fetch() {
        fetchCount += 1;
        return expected.slice(0, 41).map((post) => observed(post));
      },
      transaction() {
        const ids: string[] = [];
        return {
          delete(id) {
            assert.match(id, /^searchLab\.post\.\d{3}$/);
            ids.push(id);
            return this;
          },
          async commit() {
            deletedBatches.push(ids);
          },
        };
      },
    },
    log: () => {},
    readRecoveryReport: async () => [],
    writeRecoveryReport: async (deletedIds) => {
      reportSizes.push(deletedIds.length);
    },
  });

  assert.equal(fetchCount, 2);
  assert.deepEqual(
    deletedBatches.map((batch) => batch.length),
    [20, 20, 1],
  );
  assert.deepEqual(reportSizes, [20, 40, 41]);
  assert.deepEqual(
    result.deletedIds,
    expected.slice(0, 41).map((post) => post._id),
  );
});

test("apply refuses deletion when fresh eligibility differs from confirmation", async () => {
  const expected = buildSearchLabPosts();
  let fetchCount = 0;

  await assert.rejects(
    runSearchContentCleanup({
      argv: ["--apply", "--confirm-owned-count=2"],
      env: {
        SANITY_PROJECT_ID: "project123",
        SANITY_DATASET: "production",
        SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
      },
      client: {
        async fetch() {
          fetchCount += 1;
          if (fetchCount === 1) {
            return expected.slice(0, 2).map((post) => observed(post));
          }
          return [observed(expected[0]!)];
        },
        transaction() {
          throw new Error("changed fresh read must not create a transaction");
        },
      },
      log: () => {},
    }),
    /fresh cleanup eligibility changed/,
  );
  assert.equal(fetchCount, 2);
});

test("a partial apply persists completed IDs and safely resumes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "search-cleanup-resume-"));
  const expected = buildSearchLabPosts().slice(0, 21);
  const persisted = expected.map((post) => observed(post));
  let fetchCount = 0;
  let commitCount = 0;
  let failSecondCommit = true;

  const client = {
    async fetch() {
      fetchCount += 1;
      return persisted.map((post) => structuredClone(post));
    },
    transaction() {
      const ids: string[] = [];
      return {
        delete(id: string) {
          ids.push(id);
          return this;
        },
        async commit() {
          commitCount += 1;
          if (failSecondCommit && commitCount === 2) {
            throw new Error("simulated cleanup batch failure");
          }
          for (const id of ids) {
            const index = persisted.findIndex((post) => post._id === id);
            assert.notEqual(index, -1);
            persisted.splice(index, 1);
          }
        },
      };
    },
  };
  const dependencies = {
    argv: ["--apply", "--confirm-owned-count=21"],
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
      runSearchContentCleanup(dependencies),
      /simulated cleanup batch failure/,
    );
    assert.equal(persisted.length, 1);

    const partialReport = JSON.parse(
      await readFile(join(cwd, ".search-lab", "cleanup-recovery.json"), "utf8"),
    ) as { deletedIds: string[] };
    assert.deepEqual(
      partialReport.deletedIds,
      expected.slice(0, 20).map((post) => post._id),
    );

    failSecondCommit = false;
    commitCount = 0;
    fetchCount = 0;
    const resumed = await runSearchContentCleanup({
      ...dependencies,
      argv: ["--apply", "--confirm-owned-count=1"],
    });
    assert.deepEqual(resumed.deletedIds, [expected[20]!._id]);

    const finalReport = JSON.parse(
      await readFile(join(cwd, ".search-lab", "cleanup-recovery.json"), "utf8"),
    ) as { deletedIds: string[] };
    assert.deepEqual(
      finalReport.deletedIds,
      expected.map((post) => post._id),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
