# Spec: Local Elasticsearch search for Sanity blog posts

## Status and approval

Approved by the owner on 2026-09-13. No implementation, Docker startup,
dependency changes, Sanity writes, webhook changes, push or deployment is
authorized by this approval. The implementation plan has a separate review gate.

## Objective

Learn how Elasticsearch complements Sanity using this existing learning store,
then demonstrate keyword relevance and pagination against approximately 100
synthetic blog posts. This is a proposed learning architecture, not a statement
about Keystone's implementation or proof of production-scale performance.

Sanity remains the source of truth. Elasticsearch is a disposable, rebuildable
search projection. Existing Sanity-backed detail pages remain authoritative.

## Confirmed scope

- Base implementation: `learning/next15-stable-caching`, Next.js 15.5.25.
- Run Next.js and Elasticsearch locally; Elasticsearch runs in Docker.
- Reuse the existing Sanity `production` dataset.
- Create approximately 100 clearly identified synthetic published posts, visible
  on the existing blog. Preserve all pre-existing documents.
- Index all eligible published blog posts, not only the generated examples.
- Demonstrate ranked keyword search and numbered pagination.
- Synchronize manually, including changes, deletions and unpublishing.
- No Redis, Shopify search changes, education-specific rebuild, hosted search,
  live search webhooks, vector search, autocomplete or performance benchmark.

## Proposed design choices for approval

1. Add `/blog/search`; leave Shopify `/search` and blog detail URLs unchanged.
2. Use ten results per page with Elasticsearch `from`/`size` pagination.
3. Use English sample content and English text analysis; multilingual support is
   outside this first experiment.
4. Rebuild a fresh index on each manual sync and switch a read alias only after
   successful validation. Do not delete stale documents from the active index
   incrementally while reading Sanity.
5. Use Elasticsearch's HTTP API from server-only modules with explicit
   `no-store` requests. A JavaScript Elasticsearch client is not necessary for
   this small experiment; REST exposes the operations being learned.

These choices are proposals, not implementation already present in the repo.

## Architecture and boundaries

```text
Reviewed fixture manifest → explicit seed command → Sanity production
                                                      |
                                   manual sync (published, non-CDN read)
                                                      |
                                              index projection
                                                      |
                                         new versioned local index
                                                      |
                                  validate + refresh + atomic alias swap
                                                      |
Browser → /blog/search → server search service → Elasticsearch read alias
   |
   └── result link → /blog/[slug] → existing Sanity Data Cache → Sanity
```

The search feature comprises a fixture tool, index lifecycle tool and search
adapter/UI. These are supporting parts of one blog-search experiment, not new
independent production services. Implement and test a thin end-to-end slice
before broadening the dataset.

Existing signed Sanity cache webhooks remain unchanged and do not contact local
Elasticsearch. Existing Production subscriptions may receive the approved seed
writes; no webhook URL is repointed to localhost. Search changes appear only
after manual synchronization. Next.js blog-detail caching remains a separate
freshness boundary: a fresh search result does not itself invalidate a cached
local detail page. Verification must explicitly account for that distinction.

## Existing repository context

- `lib/sanity/types.ts`: post fields consumed by the frontend.
- `lib/sanity/queries.ts`: published post reads, including slug projection.
- `lib/sanity/client.ts`: published perspective and `useCdn: false`.
- `lib/sanity/cache.ts`: tagged, one-hour `unstable_cache` boundaries.
- `lib/sanity/utils.ts`: existing Portable Text to plain text conversion.
- `app/blog/page.tsx`: currently renders all published posts, without pagination.
- `app/blog/[slug]/page.tsx`: existing canonical post route.

The Studio schema is not in this repository. Frontend TypeScript types are not
proof of Studio validation rules; schema verification is a prerequisite to seed
writes. The existing all-posts blog listing is unchanged in this version; only
the new search results are paginated.

## Search projection and mapping

Index only `_type == "post"` documents returned by the published perspective
with a nonempty title and usable slug. Never index drafts. Required-field errors
in a selected document fail the sync rather than silently dropping that post.
Reject duplicate slugs and unsafe path segments before promotion.

| Field         | Elasticsearch mapping    | Purpose                                |
| ------------- | ------------------------ | -------------------------------------- |
| `id`          | `keyword`                | Sanity document ID; stable tie-breaker |
| `slug`        | `keyword`                | Canonical result link                  |
| `title`       | `text`, English analyzer | Highest-weight searchable field        |
| `excerpt`     | `text`, English analyzer | Searchable summary                     |
| `bodyText`    | `text`, English analyzer | Flattened Portable Text                |
| `publishedAt` | `date`                   | Display and empty-query ordering       |
| `updatedAt`   | `date`                   | Inspect synchronization state          |

Use Sanity `_id` as Elasticsearch `_id` as well. Use an explicit strict mapping;
normalize absent optional excerpt/body to empty strings. Validate dates before
indexing. Do not index full Portable Text, credentials or unpublished documents.
The projection is an allowlist, not a copy of the entire Sanity document.

## Query and pagination contract

- URL: `/blog/search?q=<text>&page=<positive integer>`.
- Trim queries; maximum 200 characters. Fixed page size: ten.
- Reject malformed, repeated or oversized parameters with a clear validation
  state without calling Elasticsearch; never accept raw query DSL from a user.
- Nonempty query: `multi_match`, `best_fields`, fields
  `title^3`, `excerpt^2`, `bodyText`, and `operator: "and"`.
- Sort matching results by `_score` descending, then `id` ascending.
- Empty query: list indexed posts by `publishedAt` descending, then `id`
  ascending. Opening the search page therefore works before typing.
- Return an exact total for this bounded dataset, ten results per page, and
  navigable previous/next links preserving the query.
- Limit the request window to the first 1,000 hits (100 pages). If the corpus
  outgrows this lab, show the limit rather than silently increasing deep paging.
- A valid page beyond the actual result count shows no results and a way back.
- The unchanged-index test must show no duplicates across adjacent pages.
  Alias replacement between page requests can change result ordering; snapshot
  consistency is not promised. PIT plus `search_after` is a later lesson.
- Render titles/excerpts as text, not untrusted HTML. Highlighting is deferred.
- If Elasticsearch is unavailable, show a distinct search-unavailable state and
  a link back to `/blog`; do not misreport the failure as zero matches or silently
  substitute GROQ search.

Field boosts influence scoring; they do not guarantee every title match outranks
every body match. Use controlled fixture pairs for explainable ranking tests and
avoid asserting exact floating-point scores.

## Manual index synchronization

1. Verify the configured Elasticsearch endpoint is loopback and the target
   index/alias belongs to this repository's search lab.
2. Fetch the complete eligible corpus directly from Sanity, bypassing existing
   Next.js persistent accessor caches. Use published perspective and no CDN.
3. Normalize and validate every selected post before promotion. Abort on a
   failed source read; a failed response must never be treated as an empty list.
4. Create a fresh versioned index with the explicit mapping. Use one primary
   shard and zero replicas for a disposable single-node lab.
5. Bulk index the projection. Inspect every bulk item; HTTP 200 alone is not
   evidence that all writes succeeded.
6. Refresh and verify indexed IDs/count against the source manifest.
7. Atomically replace the single-index read alias, with fail-closed handling of
   unexpected alias state. Serialize local sync runs; concurrent publication is
   not supported.
8. Retain the previously active index for rollback. Cleanup may delete only
   explicitly identified lab-owned inactive indexes, never wildcard targets.

If any step before promotion fails, leave the previous alias unchanged. A later
successful rebuild naturally removes deleted/unpublished posts from search.
An unexpectedly empty corpus requires explicit confirmation before replacing a
nonempty index. The source is not a transactional snapshot during concurrent
editing; stop edits during the lab sync and rerun afterward if needed.

## Synthetic content and dataset safeguards

- Prepare exactly 100 proposed English posts in a reviewable local manifest.
- Vary titles, excerpts, body length and vocabulary across a few coherent topics.
  Include controlled examples for exact terms, stemming, title/body emphasis,
  multi-word queries and no-match queries.
- Use original synthetic text, no real personal data or copied copyrighted posts.
- Clearly identify sample content in its visible text. Use root-level IDs
  `search-lab-post-001` through `search-lab-post-100` and a unique `search-lab-`
  slug prefix plus a manifest recording ownership and expected content digests.
  Do not use dotted IDs: Sanity treats them as private document paths that the
  intentionally unauthenticated storefront cannot read.
- Verify actual Studio schema constraints before preparing the write payloads.
- Dry-run is the default. Show target project/dataset, count and collision
  checks without exposing tokens. Require explicit owner approval to publish.
- Do not overwrite an existing document merely because its ID has the prefix.
  On repeat runs, skip only verified identical owned documents; refuse conflicts.
- Seed writes are bounded batches with resumable outcomes, not assumed atomic
  across all 100 documents. Record created IDs for recovery.
- Use a separate local Sanity write credential; never expose it to browser code
  or commit it. The search runtime does not need write permission.
- Cleanup is a separate approved dry-run/apply operation restricted to manifest
  IDs with matching ownership/content evidence. Refuse changed documents and
  unexpected references rather than force deletion. Preserve original posts.
- The posts will affect the live blog and sitemap and may trigger existing
  Production cache webhooks. Publish in bounded batches, not a request storm.

## Local runtime and security

- Pin an exact supported Elasticsearch Docker version (and record its digest)
  during the plan, after checking machine architecture and Docker resources.
  Never use an unpinned `latest` tag.
- Bind HTTP only to `127.0.0.1`; do not publish the transport port or use a tunnel.
  A simplified authentication-disabled configuration, if selected, is strictly
  disposable localhost-only and must not be copied to hosted infrastructure.
- Use a named local volume and an explicit destructive volume-removal command.
- Keep the endpoint/index name in server-only environment variables; no
  `NEXT_PUBLIC_` credentials or endpoint proxy supplied by request parameters.
- Set finite connection/request timeouts and bound response sizes and sync batch
  sizes in the implementation plan.
- No persistent cache for search responses in v1: index refresh/alias promotion
  must not be hidden behind another Next.js Data Cache entry.
- Do not expose indexing, seeding or cleanup as public HTTP routes.
- Keep search opt-in for local development; importing existing blog routes must
  not require Elasticsearch to be configured or reachable.

## Proposed file boundaries

- `compose.search.yaml`: disposable local Elasticsearch service.
- `lib/search/`: validated projection, query builder and server-only REST adapter.
- `scripts/search/`: fixture dry-run/apply, sync and guarded cleanup commands.
- `fixtures/search/`: synthetic content manifest and expected query cases.
- `app/blog/search/page.tsx`: server-rendered search form/results/pagination.
- `docs/learning/sanity-elasticsearch.md`: setup and interview explanation.
- Tests beside modules as `*.test.ts`; Docker integration tests explicitly opt-in.

Exact file splits and command implementation belong to the approved plan.

## Commands

Existing verification commands:

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm dev
```

Proposed command interface (not implemented yet):

```sh
docker compose -f compose.search.yaml up -d --wait
pnpm search:seed -- --dry-run
pnpm search:seed -- --apply
pnpm search:sync -- --dry-run
pnpm search:sync -- --apply
pnpm test:search:integration
pnpm search:cleanup-content -- --dry-run
pnpm search:cleanup-content -- --apply
docker compose -f compose.search.yaml down
```

Validate package-manager argument forwarding when implementing these commands.
No destructive cleanup runs implicitly as part of tests or normal shutdown.

## Code style and testing

Follow existing TypeScript, double quotes, semicolons, named exports, Prettier
and the Node test runner. Keep projection/query construction pure and inject
network dependencies for tests. Example of the desired boundary:

```ts
type SearchInput = { query: string; page: number };
type SearchResult = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
};
type SearchResponse = { results: SearchResult[]; total: number; page: number };
```

Tests must cover parameter validation, Portable Text projection, omitted drafts,
invalid dates/slugs, deterministic sorting, pagination and query construction.
Network contract tests must cover timeouts, source-read failure, bulk item
failure, failed validation and alias promotion failure preserving prior results.
Seed/cleanup tests must prove no pre-existing or modified document is overwritten
or deleted. Automated tests use fixtures, never write to Sanity production.

Opt-in Docker integration tests verify real mappings, analysis, ranking pairs,
exact counts, multi-page results and rebuild removal. Browser verification checks
form submission, query-preserving links, empty/error states and result navigation.
Existing Shopify and Sanity tests/type/build gates remain intact. Dependency
advisories remain separately tracked; no weakening test or audit standards.

## Acceptance criteria

1. The owner can explain source of truth versus search projection, inverted
   indexes, analysis, BM25 relevance, field boosts and shallow pagination.
2. Local startup is reproducible with a pinned image and loopback-only access.
3. An approved seed creates 100 identifiable posts without altering existing ones.
4. A sync indexes the entire eligible corpus and validates every bulk result.
5. Search returns relevant results with controlled ranking examples and exact
   counts; successive pages contain distinct hits on an unchanged index.
6. Editing, deleting, unpublishing and changing the slug of sample posts is
   reflected after sync; existing blog detail routing still works.
7. A failed source read or partial bulk failure cannot replace the active index.
8. Search outages produce an honest error state; normal blog and Shopify routes
   remain usable without Elasticsearch.
9. Dry-run cleanup lists only demonstrably owned unmodified sample documents;
   apply requires separate explicit approval.
10. Tests, type checking, formatting, build and manual browser checks pass before
    declaring the experiment complete. No Vercel deployment is required.

## Boundaries and remaining gates

- Always: preserve original content, keep secrets server-side, use dry-runs and
  bounded writes, review changes, and maintain separate stable/main branches.
- Ask first: approve this spec and then the plan; approve dependencies, actual
  Sanity writes/deletes, external configuration, pushing and merging separately.
- Never: replace Shopify search, repoint current webhooks, index drafts, expose
  local Elasticsearch publicly, use wildcard cleanup or weaken failing checks.

Before implementation: verify Studio schema availability, Docker prerequisites,
exact Elasticsearch version/resource budget and access to a scoped write token.
No secret value should be supplied in chat. These are explicit prerequisites,
not permission to guess or proceed with live writes.

## Official references

- https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-multi-match-query
- https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results
- https://www.elastic.co/docs/manage-data/data-store/aliases
- https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-bulk
- https://www.elastic.co/docs/reference/elasticsearch/rest-apis/refresh-parameter
- https://www.sanity.io/docs/content-lake/perspectives
- https://nextjs.org/docs/15/app/api-reference/functions/fetch
