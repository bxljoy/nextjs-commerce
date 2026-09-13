# Sanity Elasticsearch Local Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Elasticsearch-backed Sanity blog search that demonstrates relevance ranking and pagination, then safely create 100 identifiable learning posts after separate approval.

**Architecture:** Sanity remains authoritative. A manual command reads the complete published post corpus directly from Sanity, builds and validates a fresh versioned Elasticsearch index, and atomically moves a read alias only after success. A server-rendered `/blog/search` page queries that local alias without adding another Next.js cache layer; existing `/blog/[slug]` pages continue to read Sanity.

**Tech Stack:** Next.js `15.5.25`, React `19.0.0`, TypeScript `5.8.2`, Node `22.15.0`, pnpm `11.22.0`, existing `@sanity/client`, Node test runner, Docker Compose `v5.1.2`, Elasticsearch `9.5.3` pinned to manifest digest `sha256:f456578fc2a620a8a4f4c21d070fff1f6070345adb2be5e5626b65be72aea350`.

**Spec:** `docs/specs/sanity-elasticsearch-local.md`

**Status:** Draft for owner review. No implementation or live Sanity operation is authorized yet.

## Global Constraints

- Base all work on `learning/next15-stable-caching`; do not merge it into `main`.
- Keep Sanity as source of truth and Elasticsearch as a disposable projection.
- Bind Elasticsearch only to `127.0.0.1`; no tunnel, Vercel deployment or hosted search in this plan.
- Do not change Shopify search, existing Sanity cache webhooks or existing blog detail behavior.
- Add no Elasticsearch JavaScript client; use its HTTP API to expose the learning concepts.
- Search only published posts; never index drafts or full Portable Text objects.
- Do not cache Elasticsearch search responses in Next's Data Cache.
- Preserve the five currently observed posts and every other pre-existing Sanity document.
- Seed and cleanup commands default to dry-run. Live Sanity writes/deletes require a separate owner approval after reviewing exact output.
- Use a dedicated local `SANITY_SEARCH_LAB_WRITE_TOKEN`; never reuse, print or commit a personal CLI token.
- Use deterministic `searchLab.post.NNN` IDs and `search-lab-...` slugs; refuse collisions and changed-document cleanup.
- No wildcard index deletion. Retain the previously active versioned index for rollback.
- Keep inherited dependency remediation separate; never weaken tests or apply a forced audit fix.
- Obtain explicit approval before committing/pushing a completed feature, changing external configuration, or performing live content operations.

## Verified planning prerequisites

- Host and Docker engine are ARM64/aarch64; Docker uses the `orbstack` context.
- Docker has eight CPUs and approximately 8 GB memory available; repository filesystem has ample free space.
- Elasticsearch `9.5.3` publishes an ARM64 manifest and a multi-platform immutable digest.
- The existing Sanity dataset was read successfully and currently contains five `_type == "post"` documents.
- `.env` contains read configuration and a webhook secret, but no write token.
- No Sanity Studio schema/config is present in this repository. Task 7 cannot apply seed writes until the actual Studio `post` schema is inspected.
- Global Sanity CLI authentication exists, but this plan explicitly forbids using that broad credential for automated writes.

---

### Task 1: Establish the safe local Elasticsearch boundary

**Files:**

- Create: `compose.search.yaml`
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `scripts/search/config.ts`
- Test: `scripts/search/config.test.ts`

**Interfaces:**

- Produces: `SearchLabConfig`, `readSearchLabConfig(env)`, `assertSafeLabIndexName(name)`, and an Elasticsearch service on `http://127.0.0.1:9200`.
- Consumes: no application feature code.

- [x] **Step 1: Write failing configuration tests**

Cover an exact valid local configuration and rejection of remote hosts, embedded credentials, URL paths/query strings, invalid ports and index names outside `commerce-sanity-posts` / `commerce-sanity-posts-v*`.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readSearchLabConfig } from "./config.ts";

test("accepts the loopback-only search lab", () => {
  assert.deepEqual(
    readSearchLabConfig({
      ELASTICSEARCH_URL: "http://127.0.0.1:9200",
      ELASTICSEARCH_INDEX_ALIAS: "commerce-sanity-posts",
    }),
    {
      elasticsearchUrl: "http://127.0.0.1:9200",
      indexAlias: "commerce-sanity-posts",
    },
  );
});

test("rejects a remote Elasticsearch endpoint", () => {
  assert.throws(() =>
    readSearchLabConfig({
      ELASTICSEARCH_URL: "http://search.example.com:9200",
      ELASTICSEARCH_INDEX_ALIAS: "commerce-sanity-posts",
    }),
  );
});
```

- [x] **Step 2: Run the focused test and observe the missing-module failure**

```bash
pnpm test:unit -- scripts/search/config.test.ts
```

Expected: fail because `scripts/search/config.ts` does not exist.

- [x] **Step 3: Implement strict environment validation**

Use a pure function accepting `Record<string, string | undefined>`. Permit only
`http://127.0.0.1:9200` or `http://localhost:9200`, no credentials/path/query/hash.
Require alias `commerce-sanity-posts`. Allow generated names only when they match
`/^commerce-sanity-posts-v[0-9]{13}$/`.

```ts
export type SearchLabConfig = {
  elasticsearchUrl: string;
  indexAlias: "commerce-sanity-posts";
};

export function readSearchLabConfig(
  env: Record<string, string | undefined>,
): SearchLabConfig;
```

- [x] **Step 4: Add the pinned local Docker service**

`compose.search.yaml` must use:

```yaml
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:9.5.3@sha256:f456578fc2a620a8a4f4c21d070fff1f6070345adb2be5e5626b65be72aea350
    environment:
      discovery.type: single-node
      xpack.security.enabled: "false"
      ES_JAVA_OPTS: -Xms512m -Xmx512m
    ports:
      - "127.0.0.1:9200:9200"
    volumes:
      - commerce-search-es-data:/usr/share/elasticsearch/data
    mem_limit: 2g
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl --fail --silent http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=1s >/dev/null",
        ]
      interval: 5s
      timeout: 3s
      retries: 30

volumes:
  commerce-search-es-data:
```

Add blank/example `ELASTICSEARCH_URL`, `ELASTICSEARCH_INDEX_ALIAS` and
`SANITY_SEARCH_LAB_WRITE_TOKEN` entries to `.env.example`. Ignore
`/.search-lab/`, which will hold only local lock/recovery reports.

- [x] **Step 5: Verify the runtime without leaving it running**

```bash
docker compose -f compose.search.yaml config
docker compose -f compose.search.yaml pull
docker compose -f compose.search.yaml up -d --wait
curl --fail --silent http://127.0.0.1:9200/
docker compose -f compose.search.yaml down
pnpm test:unit -- scripts/search/config.test.ts
pnpm exec tsc --noEmit
```

Expected: health check and focused tests pass; the named data volume remains.
Do not run `down -v` during normal verification.

- [x] **Step 6: Commit the local boundary**

```bash
git add compose.search.yaml .env.example .gitignore scripts/search/config.ts scripts/search/config.test.ts
git diff --cached --check
git commit -m "chore: add local Elasticsearch search lab"
```

---

### Task 2: Define and validate the search projection

**Files:**

- Create: `lib/search/contracts.ts`
- Create: `lib/search/projection.ts`
- Test: `lib/search/projection.test.ts`
- Create: `lib/search/mapping.ts`
- Test: `lib/search/mapping.test.ts`

**Interfaces:**

- Produces: `SanityPostSource`, `SearchPostDocument`, `SearchHit`, `SearchPage`, `projectPost(post)`, and `POST_INDEX_MAPPING`.
- Consumes: `toPlainText` from `lib/sanity/utils.ts`.

- [x] **Step 1: Define the transport contracts**

```ts
export type SanityPostSource = {
  _id: string;
  title: string;
  slug: string;
  publishedAt: string;
  excerpt?: string;
  body?: SanityBody;
  _updatedAt: string;
};

export type SearchPostDocument = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyText: string;
  publishedAt: string;
  updatedAt: string;
};

export type SearchHit = Pick<
  SearchPostDocument,
  "id" | "slug" | "title" | "excerpt" | "publishedAt"
> & { score: number | null };

export type SearchPage = {
  results: SearchHit[];
  total: number;
  page: number;
  pageSize: 10;
};
```

- [x] **Step 2: Write failing projection and mapping tests**

Test Portable Text flattening, optional fields becoming empty strings, invalid
IDs/titles/slugs/dates failing, and a strict mapping with `keyword`, English
`text`, and `date` fields plus one shard and zero replicas.

```ts
test("projects only allowlisted searchable fields", () => {
  assert.deepEqual(projectPost(sourcePost), {
    id: "post-1",
    slug: "cache-boundaries",
    title: "Cache boundaries",
    excerpt: "A concise summary",
    bodyText: "Next and Sanity cache different boundaries.",
    publishedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  });
});
```

- [x] **Step 3: Observe the failures**

```bash
pnpm test:unit -- lib/search/projection.test.ts lib/search/mapping.test.ts
```

Expected: fail because the production modules are absent.

- [x] **Step 4: Implement projection validation and explicit mapping**

`projectPost` must reject non-object values, missing required fields, noncanonical
slugs and invalid ISO dates. Normalize optional excerpt/body to `""`. The
mapping must set `dynamic: "strict"`; `title`, `excerpt`, and `bodyText` use the
`english` analyzer.

- [x] **Step 5: Run focused and existing tests**

```bash
pnpm test:unit -- lib/search/projection.test.ts lib/search/mapping.test.ts
pnpm test
pnpm exec tsc --noEmit
```

- [x] **Step 6: Commit the projection contract**

```bash
git add lib/search/contracts.ts lib/search/projection.ts lib/search/projection.test.ts lib/search/mapping.ts lib/search/mapping.test.ts
git diff --cached --check
git commit -m "feat: define Sanity search projection"
```

---

### Task 3: Build deterministic search input and query semantics

**Files:**

- Create: `lib/search/input.ts`
- Test: `lib/search/input.test.ts`
- Create: `lib/search/query.ts`
- Test: `lib/search/query.test.ts`

**Interfaces:**

- Produces: `SearchInput`, `parseSearchInput(searchParams)`, and `buildPostSearchRequest(input)`.
- Consumes: page size `10` and maximum page `100` from this task.

- [x] **Step 1: Write failing boundary tests**

Cover absent/blank query, trimming, 200-character maximum, repeated values,
noninteger/negative/zero/over-100 pages, and HTML-like text remaining data rather
than becoming query DSL.

```ts
test("parses a normal query and page", () => {
  assert.deepEqual(parseSearchInput({ q: "  cache layers  ", page: "2" }), {
    query: "cache layers",
    page: 2,
  });
});

test("rejects repeated query parameters", () => {
  assert.deepEqual(parseSearchInput({ q: ["cache", "sanity"] }).ok, false);
});
```

- [x] **Step 2: Write failing Elasticsearch request tests**

Assert `from`, `size`, `track_total_hits`, source allowlist and deterministic
sort. For nonempty input assert:

```ts
{
  multi_match: {
    query: "cache layers",
    type: "best_fields",
    fields: ["title^3", "excerpt^2", "bodyText"],
    operator: "and",
  },
}
```

Empty input must use `match_all`, sort by `publishedAt: desc` then `id: asc`;
nonempty input sorts `_score: desc` then `id: asc`.

- [x] **Step 3: Observe focused failures**

```bash
pnpm test:unit -- lib/search/input.test.ts lib/search/query.test.ts
```

- [x] **Step 4: Implement the pure parser and request builder**

Use a discriminated result so the page can distinguish validation from search
availability:

```ts
export type ParsedSearchInput =
  | { ok: true; value: { query: string; page: number } }
  | { ok: false; message: string };
```

Never interpolate input into JSON strings; construct typed objects.

- [x] **Step 5: Verify and commit**

```bash
pnpm test:unit -- lib/search/input.test.ts lib/search/query.test.ts
pnpm test
pnpm exec tsc --noEmit
git add lib/search/input.ts lib/search/input.test.ts lib/search/query.ts lib/search/query.test.ts
git diff --cached --check
git commit -m "feat: define blog search query semantics"
```

---

### Task 4: Add the server-only Elasticsearch read adapter

**Files:**

- Create: `lib/search/elasticsearch.ts`
- Test: `lib/search/elasticsearch.test.ts`
- Create: `lib/search/service.ts`
- Test: `lib/search/service.test.ts`
- Create: `lib/search/server.ts`

**Interfaces:**

- Produces: `requestElasticsearch<T>(request)`, `searchPosts(input, dependencies)`, `SearchUnavailableError`, and configured `searchPublishedPosts(input)`.
- Consumes: Task 1 configuration and Task 3 query builder.

- [x] **Step 1: Write failing HTTP adapter tests**

Inject `fetch`. Assert URL construction cannot escape the configured origin;
requests use `cache: "no-store"`, JSON content type and a three-second timeout.
Support an explicit bounded set of accepted statuses so alias inspection can
handle 404 without accepting arbitrary failures. Reject other non-2xx responses,
invalid JSON, oversized streamed responses, and unexpected response shapes with
generic `SearchUnavailableError` messages that do not include response bodies.

```ts
test("search requests explicitly bypass Next caching", async () => {
  await requestElasticsearch({
    baseUrl: "http://127.0.0.1:9200",
    path: "/commerce-sanity-posts/_search",
    method: "POST",
    body: { query: { match_all: {} } },
    fetch: fakeFetch,
  });
  assert.equal(capturedInit.cache, "no-store");
});
```

- [x] **Step 2: Write failing search-service tests**

Test hit mapping, exact total extraction, score preservation, unavailable errors,
and rejection of malformed `_source` documents. Elasticsearch responses are
third-party input and must be validated before rendering.

- [x] **Step 3: Observe failures**

```bash
pnpm test:unit -- lib/search/elasticsearch.test.ts lib/search/service.test.ts
```

- [x] **Step 4: Implement the adapters**

`requestElasticsearch` accepts only caller-constructed paths and reads the
response stream incrementally, cancelling and failing as soon as it exceeds 1
MiB rather than allocating an unbounded `response.text()`. `searchPosts` calls
`/{encodeURIComponent(alias)}/_search`, maps validated hits, and returns the
fixed page size. `lib/search/server.ts` begins with `import "server-only"` and
reads configuration inside the exported function so importing/building unrelated
routes does not require local Elasticsearch. It exports only:

```ts
export async function searchPublishedPosts(
  input: SearchInput,
): Promise<SearchPage>;
```

Keep `server-only` out of pure modules imported by the Node test runner.

- [x] **Step 5: Verify and commit**

```bash
pnpm test:unit -- lib/search/elasticsearch.test.ts lib/search/service.test.ts
pnpm test
pnpm exec tsc --noEmit
git add lib/search/elasticsearch.ts lib/search/elasticsearch.test.ts lib/search/service.ts lib/search/service.test.ts lib/search/server.ts
git diff --cached --check
git commit -m "feat: add Elasticsearch search adapter"
```

---

### Task 5: Deliver a server-rendered blog search slice

**Files:**

- Create: `app/blog/search/page.tsx`
- Modify: `app/blog/page.tsx`

**Interfaces:**

- Produces: public page `/blog/search?q=<text>&page=<number>`.
- Consumes: `parseSearchInput` and `searchPublishedPosts`.

- [ ] **Step 1: Add the search page with four explicit states**

Implement a Server Component with a GET form and these states:

1. Valid results, with title, excerpt, date and `/blog/[slug]` link.
2. Valid zero results, distinct from an outage.
3. Invalid query/page, without calling Elasticsearch.
4. `SearchUnavailableError`, with a link back to `/blog` and no stack/body.

The component accepts:

```ts
searchParams: Promise<{
  q?: string | string[];
  page?: string | string[];
}>;
```

Use plain React text rendering. Build previous/next links with `URLSearchParams`
so the query survives. Show exact total and current page; disable previous on
page 1 and next when `page * 10 >= total`.

- [ ] **Step 2: Add an opt-in link from the existing blog**

Add a small “Search posts” link near the `/blog` heading. Do not replace or
paginate the existing list in this experiment.

- [ ] **Step 3: Verify without Elasticsearch configured**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

Expected: all existing routes build; `/blog` remains usable. The search page may
be dynamically rendered but must not make build-time Elasticsearch requests.

- [ ] **Step 4: Verify the first local vertical slice**

```bash
docker compose -f compose.search.yaml up -d --wait
pnpm dev
```

Manually check empty-index, malformed-query and unavailable states. Stop the dev
server and run `docker compose -f compose.search.yaml down`.

- [ ] **Step 5: Commit the vertical slice**

```bash
git add app/blog/search/page.tsx app/blog/page.tsx
git diff --cached --check
git commit -m "feat: add local blog search page"
```

### Checkpoint A: Read path

- [ ] Run `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm build`.
- [ ] Confirm no `NEXT_PUBLIC_ELASTICSEARCH_*`, public indexing route, Shopify search change, or Next cache wrapper exists.
- [ ] Obtain a focused review of Tasks 1–5 before adding write tooling.

---

### Task 6: Build fail-closed full-index synchronization

**Files:**

- Create: `scripts/search/sanity-source.ts`
- Test: `scripts/search/sanity-source.test.ts`
- Create: `scripts/search/indexer.ts`
- Test: `scripts/search/indexer.test.ts`
- Create: `scripts/search/sync.ts`

**Interfaces:**

- Produces: `fetchPublishedPostCorpus(client)`, `buildBulkBody(documents)`, `synchronizePostIndex(dependencies)`, and manual `search:sync` behavior.
- Consumes: Task 1 configuration, Task 2 projection/mapping and Task 4 HTTP adapter.

- [ ] **Step 1: Write failing Sanity source tests**

Assert one complete published-perspective query projects `_id`, title, slug,
publishedAt, excerpt, body and `_updatedAt`; drafts are not selected. An error or
malformed result must throw and never become `[]`. Reject duplicate IDs/slugs.

```ts
export const searchPostCorpusQuery = `
  *[_type == "post" && defined(slug.current)]{
    _id,
    title,
    "slug": slug.current,
    publishedAt,
    excerpt,
    body,
    _updatedAt
  }
`;
```

The script client uses `perspective: "published"` and `useCdn: false`; it does
not call the existing `unstable_cache` accessors.

- [ ] **Step 2: Write failing lifecycle tests**

Inject HTTP and clock dependencies. Cover:

- exact strict mapping used when creating `commerce-sanity-posts-v<13 digits>`;
- NDJSON bulk action `_id` equals Sanity ID;
- every bulk item inspected despite HTTP 200;
- refresh, exact count and complete ID-set validation before promotion;
- zero or one current alias target accepted, multiple targets rejected;
- one atomic `_aliases` request removes the old target and adds the new;
- failures leave the old alias untouched and attempt cleanup only of the exact
  newly-created index;
- nonempty old alias plus empty source refuses promotion unless an explicit
  `allowEmpty` dependency is true.

- [ ] **Step 3: Observe focused failures**

```bash
pnpm test:unit -- scripts/search/sanity-source.test.ts scripts/search/indexer.test.ts
```

- [ ] **Step 4: Implement source, bulk and alias lifecycle**

`buildBulkBody` ends every action/source pair with a newline. Batch at most 100
documents. The alias swap body is one request:

```ts
{
  actions: [
    ...(oldIndex ? [{ remove: { index: oldIndex, alias } }] : []),
    { add: { index: newIndex, alias, is_write_index: false } },
  ],
}
```

Use an exclusive `/.search-lab/sync.lock`; report and stop if it exists. Write a
recovery report containing index names/counts only—never document bodies or
environment values. `--dry-run` is default; `--apply` performs changes.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test:unit -- scripts/search/sanity-source.test.ts scripts/search/indexer.test.ts
pnpm test
pnpm exec tsc --noEmit
git add scripts/search/sanity-source.ts scripts/search/sanity-source.test.ts scripts/search/indexer.ts scripts/search/indexer.test.ts scripts/search/sync.ts
git diff --cached --check
git commit -m "feat: add atomic Sanity search synchronization"
```

---

### Task 7: Prepare deterministic owned fixtures and guarded seeding

**Files:**

- Create: `fixtures/search/posts.ts`
- Test: `fixtures/search/posts.test.ts`
- Create: `scripts/search/content-ownership.ts`
- Test: `scripts/search/content-ownership.test.ts`
- Create: `scripts/search/seed.ts`

**Interfaces:**

- Produces: `buildSearchLabPosts()` with exactly 100 documents, `digestOwnedPost(post)`, `planSeed(expected, existing)`, and dry-run/apply seed CLI.
- Consumes: actual Studio schema evidence and dedicated write-token configuration.

- [ ] **Step 1: Stop and verify the actual Studio schema**

Obtain the source or owner-attested definitions for `post`, `slug`, Portable Text,
`publishedAt`, excerpt and SEO fields. Record compatibility in the learning doc.
If required fields differ from `lib/sanity/types.ts`, update the spec before
writing fixtures. Do not infer write validity from the five readable documents.

Confirm `.env` contains a separately created `SANITY_SEARCH_LAB_WRITE_TOKEN`
without printing it. Do not use the globally authenticated Sanity CLI token.

- [ ] **Step 2: Write failing fixture tests**

Require exactly 100 unique documents with IDs `searchLab.post.001` through
`searchLab.post.100`, unique `search-lab-` slugs, `_type: "post"`, valid dates,
Portable Text keys and visibly labeled titles. Assert no email, phone number,
real person name or copied existing post title appears.

Build a deterministic 10-topic × 10-angle matrix covering cache architecture,
content modeling, search relevance, accessibility, testing, observability,
performance, security, deployment and API design. Include controlled term pairs
for `distributed cache`, `content search`, stemming and title-versus-body boosts.

- [ ] **Step 3: Write failing ownership/seed-plan tests**

Cover empty target, identical rerun, conflicting ID, conflicting slug, partially
completed identical run and malformed existing documents. A prefix match alone
must never authorize overwrite. Digests cover only fixture-owned content fields,
not Sanity system fields.

```ts
export type SeedPlan = {
  create: SanitySeedPost[];
  skipIdentical: string[];
  conflicts: { id: string; reason: string }[];
};
```

Any conflict blocks the entire apply phase.

- [ ] **Step 4: Implement fixtures and dry-run-first seed CLI**

Create deterministic original text with at least three Portable Text paragraphs
per post and varied excerpts/body length. `seed.ts`:

1. validates target project/dataset without printing credentials;
2. reads all proposed IDs and slugs;
3. computes and prints counts/conflict IDs only;
4. exits after dry-run unless both `--apply` and `--confirm-count=100` are present;
5. creates only missing documents in batches of 20;
6. writes a local recovery report of successfully created IDs after each batch;
7. never patches or overwrites a document.

- [ ] **Step 5: Verify fixtures without writing Sanity**

```bash
pnpm test:unit -- fixtures/search/posts.test.ts scripts/search/content-ownership.test.ts
node --env-file=.env --no-warnings --experimental-strip-types scripts/search/seed.ts --dry-run
pnpm test
pnpm exec tsc --noEmit
```

Expected dry-run: 100 proposed, zero writes, no conflicts. If the dataset changes
before apply, rerun and review the dry-run.

- [ ] **Step 6: Commit the reviewed seed tooling, not live content state**

```bash
git add fixtures/search/posts.ts fixtures/search/posts.test.ts scripts/search/content-ownership.ts scripts/search/content-ownership.test.ts scripts/search/seed.ts
git diff --cached --check
git commit -m "feat: add guarded Sanity search fixtures"
```

---

### Task 8: Add guarded sample-content cleanup

**Files:**

- Create: `scripts/search/cleanup-content.ts`
- Test: `scripts/search/cleanup-content.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: dry-run/apply cleanup limited to manifest IDs and package command interface.
- Consumes: Task 7 fixtures and digests.

- [ ] **Step 1: Write failing cleanup-plan tests**

Test that only exact manifest IDs with matching owned-content digests and zero
incoming references are eligible. Missing documents are harmless; changed,
unexpected, draft-paired or referenced documents block deletion. Prefix-only and
wildcard inputs must be rejected.

- [ ] **Step 2: Implement cleanup with a separate apply gate**

Dry-run prints eligible/missing/blocked counts and IDs. Apply requires
`--apply --confirm-owned-count=<exact dry-run eligible count>` and a fresh read.
Delete explicit IDs in bounded transactions; never issue a GROQ `delete` or
wildcard operation. Persist completed IDs to a local recovery report.

- [ ] **Step 3: Add exact package scripts**

```json
{
  "search:seed": "node --env-file=.env --no-warnings --experimental-strip-types scripts/search/seed.ts",
  "search:sync": "node --env-file=.env --no-warnings --experimental-strip-types scripts/search/sync.ts",
  "search:cleanup-content": "node --env-file=.env --no-warnings --experimental-strip-types scripts/search/cleanup-content.ts",
  "test:search:integration": "node --env-file=.env --no-warnings --experimental-strip-types --test lib/search/elasticsearch.integration.test.ts"
}
```

Verify pnpm forwards flags exactly with dry-runs before documenting commands.

- [ ] **Step 4: Verify and commit**

```bash
pnpm test:unit -- scripts/search/cleanup-content.test.ts
pnpm search:seed -- --dry-run
pnpm search:sync -- --dry-run
pnpm search:cleanup-content -- --dry-run
pnpm test
pnpm exec tsc --noEmit
git add scripts/search/cleanup-content.ts scripts/search/cleanup-content.test.ts package.json
git diff --cached --check
git commit -m "feat: guard search-lab content cleanup"
```

### Checkpoint B: Write-tool safety

- [ ] Obtain adversarial review of collision, partial-write, alias-swap and cleanup failure paths.
- [ ] Confirm every command defaults to dry-run and tests never contact Sanity production.
- [ ] Confirm no token/body is logged and broad CLI authentication is unused.
- [ ] Do not seed until the owner reviews the exact fixture dry-run and explicitly approves the live write.

---

### Task 9: Verify Elasticsearch behavior with real local integration tests

**Files:**

- Create: `lib/search/elasticsearch.integration.test.ts`
- Create: `fixtures/search/expected-queries.ts`
- Test: `fixtures/search/expected-queries.test.ts`

**Interfaces:**

- Verifies: real Elasticsearch mapping, English analysis, ranking relationships, exact totals, pagination and rebuild deletion behavior.
- Consumes: Tasks 2–8; writes only uniquely named local test indexes.

- [ ] **Step 1: Define relationship-based expectations**

Each case identifies expected included/excluded IDs and relative ordering, not an
exact floating score. Include title boost, excerpt boost, body-only match,
English stemming, two-term `and`, no-match and empty-query date ordering.

- [ ] **Step 2: Write the opt-in integration test**

Create a unique `commerce-sanity-posts-v<timestamp>` test index, bulk a controlled
subset, refresh, query through the real adapter, verify page 1/page 2 disjointness,
and rebuild without one document to prove it disappears after alias swap. In
`after`, delete only the exact test indexes and alias created by this run.

Skip with an explicit message unless `ELASTICSEARCH_INTEGRATION=1`; never start
Docker from inside the test.

- [ ] **Step 3: Observe and tune mapping/query relationships**

```bash
docker compose -f compose.search.yaml up -d --wait
ELASTICSEARCH_INTEGRATION=1 pnpm test:search:integration
```

If an expected relationship fails, inspect `_explain` manually and adjust either
fixture wording or documented boosts. Do not assert implementation-specific
scores. Record every mapping/query decision in the learning doc later.

- [ ] **Step 4: Run full local gates and commit**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
ELASTICSEARCH_INTEGRATION=1 pnpm test:search:integration
docker compose -f compose.search.yaml down
git add lib/search/elasticsearch.integration.test.ts fixtures/search/expected-queries.ts fixtures/search/expected-queries.test.ts
git diff --cached --check
git commit -m "test: verify local Elasticsearch search behavior"
```

---

### Task 10: Perform separately approved live learning acceptance

**Files:**

- No source changes unless a reproduced defect requires a test-first correction.
- Modify after evidence exists: `docs/learning/sanity-elasticsearch.md`
- Modify for checklist evidence: `docs/superpowers/plans/2026-09-13-sanity-elasticsearch-local.md`

**Interfaces:**

- Verifies: real Sanity content creation, complete synchronization, search UX and lifecycle behavior.
- Consumes: every previous task and separate owner approvals.

- [ ] **Step 1: Create the interview learning guide before live writes**

Explain inverted index, analyzers/tokenization, BM25, field boosts, source of
truth versus projection, rebuild/alias promotion, eventual consistency,
`from`/`size` limits, PIT/`search_after` as a later design, and failure recovery.
Separate verified repository behavior from proposed hosted architecture.

- [ ] **Step 2: Present the seed gate**

Run `pnpm search:seed -- --dry-run` and present target dataset name, proposed
count, skipped-identical count and conflict IDs only. Present current source
count and rollback/cleanup rules. Obtain explicit owner approval before:

```bash
pnpm search:seed -- --apply --confirm-count=100
```

Verify 100 created or accounted for as identical, while the five baseline posts
and all other documents remain unchanged.

- [ ] **Step 3: Build and promote the complete local index**

```bash
docker compose -f compose.search.yaml up -d --wait
pnpm search:sync -- --dry-run
pnpm search:sync -- --apply
ELASTICSEARCH_INTEGRATION=1 pnpm test:search:integration
```

Compare source and index ID sets/counts. Record old/new index names without body
content. Confirm alias points to exactly one validated index and the former index
is retained.

- [ ] **Step 4: Verify ranking and pagination in the browser**

Run `pnpm dev`. Check controlled expected queries, no-match, empty-query,
malformed/oversized query, pages 1–3 with no duplicates, query-preserving links,
result navigation to existing `/blog/[slug]`, and an Elasticsearch-down error
state while `/blog` and a detail page remain usable.

- [ ] **Step 5: Obtain approval for four reversible lifecycle exercises**

Using only named generated posts, perform one edit, one slug change, one
unpublish and one delete in Sanity Studio. After each bounded set, run manual
sync and verify old search state disappears and new state appears. Account for
existing Next detail-cache behavior separately; do not claim search promotion
invalidates detail tags. Record owner-attested results without copying content or
credentials into logs.

- [ ] **Step 6: Demonstrate fail-closed rollback**

With the last good alias active, run an injected/local test failure before alias
promotion and verify searches still use the prior index. Do not corrupt the live
lab index to demonstrate failure. Verify a subsequent valid rebuild promotes and
retains the previous version.

- [ ] **Step 7: Show cleanup dry-run, but do not delete without another approval**

```bash
pnpm search:cleanup-content -- --dry-run
```

Present eligible, missing and blocked IDs/counts. Leave generated posts in the
learning dataset unless the owner separately approves the exact apply command.

- [ ] **Step 8: Run final gates and record evidence**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm audit --audit-level high
git diff --check
```

Compare audit output to the unchanged stable baseline of seven high and four
moderate advisories; do not claim inherited findings are fixed. Scan for secrets,
public Elasticsearch exposure, test weakening and unrelated changes. Obtain an
independent whole-feature review.

- [ ] **Step 9: Commit documentation only after it is accurate**

```bash
git add docs/learning/sanity-elasticsearch.md docs/superpowers/plans/2026-09-13-sanity-elasticsearch-local.md
git diff --cached --check
git commit -m "docs: explain Sanity Elasticsearch search"
```

Present exact commits and evidence. Obtain explicit approval before pushing or
merging. Do not deploy this local-only experiment to Vercel.

---

## Dependency order and execution checkpoints

```text
Task 1 local boundary
  ├── Task 2 projection ── Task 3 query ── Task 4 adapter ── Task 5 UI
  └── Task 6 synchronization
          └── Task 7 fixtures/seed ── Task 8 cleanup
Tasks 2–8 ── Task 9 real Elasticsearch integration
Tasks 1–9 ── Task 10 approved live acceptance and learning evidence
```

Tasks 2 and 3 can be prepared in parallel after Task 1. Keep Tasks 4–10
sequential because they consume shared contracts or mutate local/external state.
Use one writer per worktree and fresh review at Checkpoints A and B.

## Risks and mitigations

| Risk                                           | Impact                                   | Mitigation                                                                  |
| ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Broad Sanity write credential                  | Existing content could be modified       | Dedicated local token, deterministic IDs, dry-run default, create-only plan |
| Partial seed run                               | Some fixture posts exist                 | Batches of 20, recovery IDs, identical-only resume                          |
| ID/slug collision                              | Existing content overwritten or shadowed | Preflight both namespaces; any conflict blocks all writes                   |
| Failed/partial bulk response                   | Incomplete index promoted                | Inspect every item and compare complete ID set/count before alias swap      |
| Failed Sanity source read interpreted as empty | Active search erased                     | Throw on source errors; explicit empty-corpus override                      |
| Concurrent sync or edits                       | Nondeterministic corpus/promotion        | Exclusive local lock; stop edits during lab sync and rerun                  |
| Public insecure Elasticsearch                  | Local machine/data exposed               | Loopback port binding, no tunnel, endpoint validator                        |
| Deep paging cost                               | Increasing Elasticsearch memory work     | Fixed size 10, page maximum 100; document `search_after` later              |
| Search/detail freshness confusion              | Search and blog page disagree briefly    | Document separate caches; test both boundaries explicitly                   |
| Generated content cleanup removes edits        | Learning work/data lost                  | Digest and reference checks; refuse changed docs; separate approval         |
| Elasticsearch unavailable                      | Blog search appears empty                | Typed unavailable state; existing blog/detail routes remain independent     |
| Template content gives misleading relevance    | Weak learning evidence                   | Controlled term pairs and relationship assertions, no scale claim           |

## Plan self-review record

- Spec coverage: architecture, mapping, ranking, pagination, manual full rebuild,
  atomic promotion, fixtures, safe writes/cleanup, failures, tests and learning
  evidence each map to Tasks 1–10.
- Placeholder scan: no deferred implementation placeholders remain; hosted
  Elasticsearch and live webhook sync are explicitly out of scope.
- Type consistency: `SearchInput`, `SearchPostDocument`, `SearchPage`, alias and
  fixture naming are introduced once and consumed by later tasks.
- Scope: one local blog-search learning feature. Live writes are operational
  acceptance gates, not a second application subsystem.
