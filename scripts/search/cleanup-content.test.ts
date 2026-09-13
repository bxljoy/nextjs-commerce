import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
} from "./cleanup-content.ts";

type FakeRevisionPatch = {
  ifRevisionId(revision: string): FakeRevisionPatch;
  unset(paths: string[]): FakeRevisionPatch;
};

function fixture(index: number): SanitySeedPost {
  const post = buildSearchLabPosts()[index];
  assert.ok(post);
  return structuredClone(post);
}

type ObservedCleanupCandidate = {
  document: Record<string, unknown> & { _id: string };
  incomingReferenceIds: readonly string[];
};

function observed(
  post: SanitySeedPost,
  incomingReferenceIds: readonly string[] = [],
  revision = `rev-${post._id}`,
): ObservedCleanupCandidate {
  return {
    document: { ...structuredClone(post), _rev: revision },
    incomingReferenceIds,
  };
}

test("plans only recorded, exact, unchanged, unreferenced manifest documents as eligible", () => {
  const expected = [fixture(0), fixture(1)];

  assert.deepEqual(
    planCleanup(expected, [observed(expected[0]!)], [expected[0]!._id]),
    {
      eligibleIds: [expected[0]!._id],
      missingIds: [expected[1]!._id],
      blocked: [],
    },
  );
});

test("blocks an identical pre-existing manifest document without seed provenance", () => {
  const expected = [fixture(0)];

  assert.deepEqual(planCleanup(expected, [observed(expected[0]!)], []), {
    eligibleIds: [],
    missingIds: [],
    blocked: [
      {
        id: expected[0]!._id,
        reason: "document is not recorded as created by this search lab",
      },
    ],
  });
});

test("blocks changed, unexpected, draft-paired, and referenced documents", () => {
  const expected = [fixture(0), fixture(1), fixture(2)];
  const changed = observed(expected[0]!);
  changed.document.title = `${String(changed.document.title)} changed`;
  const draft = observed(expected[1]!);
  draft.document._id = `drafts.${expected[1]!._id}`;
  const referenced = observed(expected[2]!, ["preexisting.author"]);
  const unexpected = observed(fixture(3));
  unexpected.document._id = "search-lab-post-999";

  assert.deepEqual(
    planCleanup(
      expected,
      [changed, draft, referenced, unexpected],
      expected.map((post) => post._id),
    ),
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
          id: "search-lab-post-999",
          reason: "document is not an exact manifest ID",
        },
      ],
    },
  );
});

test("ignores known Sanity system metadata when fixture-owned fields are unchanged", () => {
  const expected = [fixture(0)];
  const withSystemMetadata = observed(expected[0]!);
  withSystemMetadata.document._system = { base: { id: expected[0]!._id } };

  assert.deepEqual(
    planCleanup(expected, [withSystemMetadata], [expected[0]!._id]),
    {
      eligibleIds: [expected[0]!._id],
      missingIds: [],
      blocked: [],
    },
  );
});

test("blocks an added editorial field even when fixture-owned fields are unchanged", () => {
  const expected = [fixture(0)];
  const changed = observed(expected[0]!);
  changed.document.coverImage = {
    _type: "image",
    asset: { _type: "reference", _ref: "image-asset" },
  };

  assert.deepEqual(planCleanup(expected, [changed], [expected[0]!._id]), {
    eligibleIds: [],
    missingIds: [],
    blocked: [
      {
        id: expected[0]!._id,
        reason: "document has non-manifest content fields: coverImage",
      },
    ],
  });
});

test("blocks nested Portable Text editorial fields omitted from the fixture", () => {
  const expected = [fixture(0)];
  const changedPost = fixture(0);
  Object.assign(changedPost.body[0] as unknown as Record<string, unknown>, {
    listItem: "bullet",
    level: 1,
  });

  assert.deepEqual(
    planCleanup(expected, [observed(changedPost)], [expected[0]!._id]),
    {
      eligibleIds: [],
      missingIds: [],
      blocked: [
        {
          id: expected[0]!._id,
          reason: "owned content differs from manifest",
        },
      ],
    },
  );
});

test("blocks a stored field that shares the computed reference alias name", () => {
  const expected = [fixture(0)];
  const changed = observed(expected[0]!);
  changed.document.incomingReferenceIds = ["stored-editorial-value"];

  assert.deepEqual(planCleanup(expected, [changed], [expected[0]!._id]), {
    eligibleIds: [],
    missingIds: [],
    blocked: [
      {
        id: expected[0]!._id,
        reason:
          "document has non-manifest content fields: incomingReferenceIds",
      },
    ],
  });
});

test("a draft pair blocks an otherwise identical published document", () => {
  const expected = [fixture(0)];
  const published = observed(expected[0]!);
  const draft = observed(expected[0]!);
  draft.document._id = `drafts.${expected[0]!._id}`;

  assert.deepEqual(
    planCleanup(expected, [published, draft], [expected[0]!._id]),
    {
      eligibleIds: [],
      missingIds: [],
      blocked: [{ id: expected[0]!._id, reason: "draft pair exists" }],
    },
  );
});

test("rejects prefix-only, wildcard, duplicate, and noncanonical manifest IDs", () => {
  const valid = fixture(0);
  const invalidIds = [
    "search-lab-post-",
    "search-lab-post-*",
    "search-lab-post-1",
    "drafts.search-lab-post-001",
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

test("validates Task 7 seed provenance against the cleanup target", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "search-cleanup-provenance-"));
  await mkdir(join(cwd, ".search-lab"));
  await writeFile(
    join(cwd, ".search-lab", "seed-recovery.json"),
    JSON.stringify({
      projectId: "another-project",
      dataset: "production",
      createdIds: [fixture(0)._id],
    }),
  );

  try {
    await assert.rejects(
      runSearchContentCleanup({
        argv: ["--dry-run"],
        cwd,
        env: {
          SANITY_PROJECT_ID: "project123",
          SANITY_DATASET: "production",
          SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
        },
        client: {
          async fetch() {
            throw new Error("invalid seed provenance must block before fetch");
          },
          transaction() {
            throw new Error("invalid seed provenance must not mutate");
          },
        },
        log: () => {},
      }),
      /seed recovery report target does not match/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
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
  changed.document.excerpt = `${String(changed.document.excerpt)} changed`;
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
      async fetch(query, parameters) {
        fetchCount += 1;
        assert.match(query, /"document": @/);
        assert.equal(parameters.ids.length, 100);
        assert.equal(parameters.lookupIds.length, 200);
        return [observed(expected[0]!), changed];
      },
      transaction() {
        throw new Error("dry-run must not create a transaction");
      },
    },
    log: (message) => logs.push(message),
    readSeedRecoveryReport: async () =>
      expected.slice(0, 2).map((post) => post._id),
    readRecoveryReport: async () => ({ completedIds: [], pendingBatch: null }),
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
          patch(_id, build) {
            build({
              ifRevisionId() {
                return this;
              },
              unset() {
                return this;
              },
            });
            return this;
          },
          delete(id) {
            assert.match(id, /^search-lab-post-\d{3}$/);
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
    readSeedRecoveryReport: async () =>
      expected.slice(0, 41).map((post) => post._id),
    readRecoveryReport: async () => ({ completedIds: [], pendingBatch: null }),
    writeRecoveryReport: async (state) => {
      if (state.pendingBatch === null)
        reportSizes.push(state.completedIds.length);
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
      readSeedRecoveryReport: async () =>
        expected.slice(0, 2).map((post) => post._id),
      readRecoveryReport: async () => ({
        completedIds: [],
        pendingBatch: null,
      }),
    }),
    /fresh cleanup eligibility changed/,
  );
  assert.equal(fetchCount, 2);
});

test("apply uses the fresh revision as an atomic delete precondition", async () => {
  const expected = [fixture(0)];
  let actualRevision = "rev-before-edit";
  let queuedDelete = false;

  await assert.rejects(
    runSearchContentCleanup({
      argv: ["--apply", "--confirm-owned-count=1"],
      env: {
        SANITY_PROJECT_ID: "project123",
        SANITY_DATASET: "production",
        SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
      },
      client: {
        async fetch() {
          return [observed(expected[0]!, [], actualRevision)];
        },
        transaction() {
          let requiredRevision: string | undefined;
          return {
            patch(
              _id: string,
              build: (patch: FakeRevisionPatch) => FakeRevisionPatch,
            ) {
              const patch = {
                ifRevisionId(revision: string) {
                  requiredRevision = revision;
                  return this;
                },
                unset(_paths: string[]) {
                  return this;
                },
              };
              build(patch);
              return this;
            },
            delete() {
              queuedDelete = true;
              actualRevision = "rev-edited-after-fresh-read";
              return this;
            },
            async commit() {
              if (requiredRevision === undefined) {
                throw new Error("revision precondition missing");
              }
              if (requiredRevision !== actualRevision) {
                throw new Error("revision conflict");
              }
            },
          };
        },
      },
      log: () => {},
      readSeedRecoveryReport: async () => [expected[0]!._id],
      readRecoveryReport: async () => ({
        completedIds: [],
        pendingBatch: null,
      }),
      writeRecoveryReport: async () => {},
    }),
    /revision conflict/,
  );

  assert.equal(queuedDelete, true);
  assert.equal(actualRevision, "rev-edited-after-fresh-read");
});

test("journals a pending batch before commit and retains it if completion persistence fails", async () => {
  const expected = [fixture(0)];
  const events: string[] = [];
  let durableState: unknown;

  await assert.rejects(
    runSearchContentCleanup({
      argv: ["--apply", "--confirm-owned-count=1"],
      env: {
        SANITY_PROJECT_ID: "project123",
        SANITY_DATASET: "production",
        SANITY_SEARCH_LAB_WRITE_TOKEN: "dedicated-test-token",
      },
      client: {
        async fetch() {
          return [observed(expected[0]!)];
        },
        transaction() {
          return {
            patch() {
              return this;
            },
            delete() {
              return this;
            },
            async commit() {
              events.push("commit");
            },
          };
        },
      },
      log: () => {},
      readSeedRecoveryReport: async () => [expected[0]!._id],
      readRecoveryReport: async () => ({
        completedIds: [],
        pendingBatch: null,
      }),
      writeRecoveryReport: async (state: {
        completedIds: readonly string[];
        pendingBatch: unknown;
      }) => {
        if (state.pendingBatch !== null) {
          events.push("write pending");
          durableState = structuredClone(state);
          return;
        }
        events.push("write complete");
        throw new Error("simulated completion journal failure");
      },
    }),
    /simulated completion journal failure/,
  );

  assert.deepEqual(events, ["write pending", "commit", "write complete"]);
  assert.deepEqual(durableState, {
    completedIds: [],
    pendingBatch: [
      { id: expected[0]!._id, revision: `rev-${expected[0]!._id}` },
    ],
  });
});

test("reconciles a pending journal when every remotely deleted ID is missing", async () => {
  const expected = [fixture(0)];
  const persistedStates: unknown[] = [];
  const result = await runSearchContentCleanup({
    argv: ["--apply", "--confirm-owned-count=0"],
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
        throw new Error("reconciled missing IDs must not create a transaction");
      },
    },
    log: () => {},
    readSeedRecoveryReport: async () => [expected[0]!._id],
    readRecoveryReport: async () => ({
      completedIds: [],
      pendingBatch: [
        { id: expected[0]!._id, revision: `rev-${expected[0]!._id}` },
      ],
    }),
    writeRecoveryReport: async (state: unknown) => {
      persistedStates.push(structuredClone(state));
    },
  });

  assert.deepEqual(result.deletedIds, []);
  assert.deepEqual(persistedStates, [
    { completedIds: [expected[0]!._id], pendingBatch: null },
  ]);
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
        patch(
          _id: string,
          build: (patch: FakeRevisionPatch) => FakeRevisionPatch,
        ) {
          const patch = {
            ifRevisionId(_revision: string) {
              return this;
            },
            unset(_paths: string[]) {
              return this;
            },
          };
          build(patch);
          return this;
        },
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
            const index = persisted.findIndex(
              (post) => post.document._id === id,
            );
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
    readSeedRecoveryReport: async () => expected.map((post) => post._id),
  };

  try {
    await assert.rejects(
      runSearchContentCleanup(dependencies),
      /simulated cleanup batch failure/,
    );
    assert.equal(persisted.length, 1);

    const partialReport = JSON.parse(
      await readFile(join(cwd, ".search-lab", "cleanup-recovery.json"), "utf8"),
    ) as {
      completedIds: string[];
      pendingBatch: { id: string; revision: string }[] | null;
    };
    assert.deepEqual(
      partialReport.completedIds,
      expected.slice(0, 20).map((post) => post._id),
    );
    assert.deepEqual(partialReport.pendingBatch, [
      {
        id: expected[20]!._id,
        revision: `rev-${expected[20]!._id}`,
      },
    ]);

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
    ) as { completedIds: string[]; pendingBatch: unknown };
    assert.deepEqual(
      finalReport.completedIds,
      expected.map((post) => post._id),
    );
    assert.equal(finalReport.pendingBatch, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
