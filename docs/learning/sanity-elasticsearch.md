# Sanity and local Elasticsearch learning guide

## Scope and safety boundary

This repository demonstrates local blog search. Sanity is the authoritative
content store; Elasticsearch is a disposable, rebuildable projection. The
existing `/blog/[slug]` detail route continues to read from Sanity, and Shopify
search and the existing Sanity cache webhooks are unchanged.

The Elasticsearch container is pinned to `9.5.3` by immutable image digest,
publishes HTTP only on `127.0.0.1:9200`, and does not publish the transport port.
Authentication is disabled only for this disposable loopback-only lab. Do not
use this configuration for a hosted service, expose it through a tunnel, or
deploy it to Vercel.

## Verified Studio schema compatibility

Before preparing the search-lab fixtures, the owner provided the Studio schema
sources at `schemaTypes/post.ts`, `schemaTypes/seo.ts`, and
`schemaTypes/index.ts` in the local `commerce-studio` checkout. They were
inspected read-only on 2026-09-13.

The registered `post` type requires a string `title`, a `slug` with a
96-character maximum, and a `publishedAt` datetime. Its optional `excerpt` is
text with a 300-character maximum. `body` accepts Portable Text blocks and
images. The optional shared `seo` object has optional title and description
fields with warnings at 60 and 160 characters respectively.

This is compatible with the frontend fields in `lib/sanity/types.ts`. That file
models the projected slug as a string for reads, while fixture writes correctly
use the Studio slug object `{ _type: "slug", current: string }`. The search-lab
fixtures provide every required field, text-only Portable Text blocks with
stable keys, excerpts within 300 characters, slugs within 96 characters, and
SEO text within the warning lengths. No schema-field change was required.

The dedicated `SANITY_SEARCH_LAB_WRITE_TOKEN` was confirmed present exactly once
and nonempty in the ignored worktree `.env`, whose mode is `600`. Its value was
not printed. Only that dedicated token may be used by the seed and cleanup
commands. The broad global Sanity CLI credential must never be used for this
lab.

## How text becomes searchable

### Inverted index

A database can find a post by scanning every document, but a search engine
instead builds an **inverted index**. Conceptually, it maps each analyzed term
to the documents and positions where that term occurs. Looking up `running`
therefore starts from a term dictionary and posting list rather than scanning
all post bodies. The index is derived data: it can be discarded and rebuilt
from Sanity.

### Analysis and tokenization

Before text enters the inverted index, an analyzer turns it into tokens. The
verified mapping in `lib/search/mapping.ts` applies Elasticsearch's `english`
analyzer to `title`, `excerpt`, and `bodyText`. Analysis includes operations such
as splitting text, lowercasing, removing common words, and reducing related
English forms to a shared stem. The same analyzer is applied to query text, so a
controlled fixture can demonstrate a query such as `running` matching `runs`.

Analysis improves recall but is language-specific and can collapse words in
surprising ways. This lab does not claim multilingual support. `id` and `slug`
are `keyword` fields because they need exact values, not full-text analysis.
`publishedAt` and `updatedAt` are dates. Dynamic mapping is strict, so an
unexpected projected field is rejected rather than silently indexed.

### BM25 relevance and field boosts

For a nonempty query, Elasticsearch scores matching documents with its BM25
similarity. At interview depth, the important factors are:

- term frequency: a term occurring usefully in a document can increase its
  score, with diminishing returns;
- inverse document frequency: a rare term is usually more informative than a
  term appearing in nearly every document;
- field-length normalization: a match in concise text can be more informative
  than the same occurrence buried in a long field.

The verified query uses `multi_match` with `best_fields`, `operator: "and"`, and
`title^3`, `excerpt^2`, `bodyText`. The boosts make title evidence three times
and excerpt evidence twice as influential at the field-query level. They are
signals, not absolute guarantees that every title match beats every body match:
BM25 statistics and the rest of each document still matter. Tests therefore use
controlled pairs and relative ordering, never fixed floating-point scores.
Matching results sort by `_score` descending and then `id` ascending for a
stable tie-breaker. An empty query uses `match_all` and sorts by `publishedAt`
descending, then `id` ascending.

## Source of truth, projection, and eventual consistency

Sanity remains the source of truth for publication state and blog detail pages.
The sync reads the complete eligible published corpus directly from Sanity with
`useCdn: false`, converts allowlisted fields to plain search documents, and does
not copy drafts or full Portable Text objects. Elasticsearch can answer keyword
and ranking questions efficiently, but it is not allowed to become the only
copy of content.

The systems are intentionally **eventually consistent**. A Sanity edit does not
appear in search until a manual rebuild is promoted. Conversely, promoting a
search index does not invalidate Next.js detail-page cache tags. Search and the
existing detail route therefore have separate freshness boundaries and must be
verified separately.

## Rebuild, validation, and atomic alias promotion

`pnpm search:sync -- --dry-run` validates the source projection without writing
Elasticsearch. Apply mode creates a fresh timestamped
`commerce-sanity-posts-v<13-digit-millisecond-timestamp>` index with one primary
shard and zero replicas. It bulk-indexes in bounded batches, checks every bulk
item, refreshes, compares exact source/index counts and complete ID sets, and
only then atomically moves the `commerce-sanity-posts` read alias.

Search reads the alias rather than a concrete version. Readers therefore see
either the old complete index or the new complete index, not a half-built mix.
The formerly active index is retained for rollback. Index cleanup must use exact
lab-owned names; wildcard deletion is forbidden.

## Failure recovery and fail-closed behavior

The synchronization path fails closed:

1. A source read failure is an error, never an empty corpus.
2. Duplicate IDs/slugs, invalid projection fields, a partial bulk response,
   count mismatch, or ID-set mismatch prevents promotion.
3. Replacing a nonempty index with an empty source requires a separate explicit
   override.
4. Before promotion failure leaves the last good alias active and attempts
   bounded cleanup of only the newly created exact index.
5. An ambiguous promotion response triggers an exact alias-state check. If the
   new index is proven active, the run is treated as promoted; if the old index
   is proven active, exact new-index cleanup is safe; otherwise the candidate is
   retained with a recovery report rather than guessed away.
6. A subsequent valid rebuild can promote normally while retaining the prior
   version.

This means Elasticsearch unavailability produces an honest search-unavailable
state. It must not be presented as zero results or trigger an implicit fallback
to GROQ. `/blog` and existing detail pages remain independent of Elasticsearch.

## Pagination and its limit

The verified request uses fixed `size: 10` and computes `from` as
`(page - 1) * 10`. Exact totals are requested with `track_total_hits: true`.
Inputs allow only one `q` and one `page`, trim the query, cap it at 200
characters, require a positive integer page, and limit this lab to pages 1–100,
or the first 1,000 hits. Previous/next links preserve the query. Tests on an
unchanged index verify that adjacent pages have no duplicate IDs.

`from`/`size` is easy to explain and sufficient for this bounded 100-post lab,
but deep offsets make Elasticsearch collect and discard increasingly many
ranked hits. Also, if the alias changes between page requests, ordering can
change; this lab does not promise snapshot consistency.

For a larger or production design, use a point in time (PIT) to hold a stable
search snapshot and `search_after` with a deterministic sort tuple to request
the next page. That is a later design, not verified repository behavior.

## Safe local workflow

All content mutation requires separate owner approval. Dry-run is the default.
The seed uses exactly 100 deterministic root-level IDs
(`search-lab-post-001` through `search-lab-post-100`) and owned slug prefixes,
refuses ID or slug conflicts, skips only documents matching the normalized
fixture-owned field digest, writes in batches of 20, and records exact created
IDs for recovery.
It must preserve the five observed baseline posts and every other pre-existing
document.

Cleanup is a separate operation and a dry-run does not authorize deletion. Only
manifest IDs recorded as created by this lab can be eligible. Cleanup removes only known top-level Sanity system metadata and then compares
the complete observed document shape and values with the fixture. Added
editorial data at the top level (such as `coverImage`) or inside Portable Text
therefore blocks deletion. Draft pairs, changed digests,
incoming references, malformed observations, and documents not recorded as
lab-created are also blocked. Cleanup apply would require another exact
owner-approved command and revision-guarded bounded deletes. No wildcard
cleanup is available.

## Live local acceptance evidence

### Public document ID correction and final corpus

The first separately approved seed used the originally planned dotted IDs
`searchLab.post.NNN`. It created exactly 100 collision-free documents, but a
bounded read-only diagnosis found that authenticated raw/published reads saw all
100 while the intentionally unauthenticated published storefront read still saw
only the five baseline posts. In Sanity, dotted IDs are private document paths.
Adding a token to only the sync was rejected because search results would then
link to storefront detail pages that could not read those documents.

A separately approved cleanup deleted exactly those 100 unchanged,
unreferenced, lab-recorded dotted-ID documents in bounded transactions. Its
follow-up dry-run found all 100 missing, none eligible or blocked, while the five
baseline posts remained published. Tests were changed first and failed against
the old fixture/cleanup pattern; the fixture and exact cleanup allowlist were
then minimally changed to root-level `search-lab-post-NNN` IDs. The spec and plan
now record that constraint.

A fresh dry-run for the corrected manifest reported 100 creates, zero identical
skips, and zero conflicts. After separate approval, the apply created exactly 100. The final dry-run reports zero creates, 100 identical skips, and zero
conflicts. The unauthenticated published source contains 105 posts: the five
baseline posts plus all 100 corrected generated posts.

### Complete index and alias state

The first complete promotion moved the previously absent alias to
`commerce-sanity-posts-v1789326507181`. Source/index comparison reported 105 IDs
on each side, with zero missing or unexpected IDs. Lifecycle exercises used
fresh full rebuilds rather than incremental edits.

Final read-only verification reports 105 source IDs and 105 indexed IDs, with
zero set differences. The `commerce-sanity-posts` alias points to exactly one
validated index, `commerce-sanity-posts-v1789329295426`. The immediately prior
validated `commerce-sanity-posts-v1789329213050` index remains available with
105 documents; no wildcard deletion was used. Additional earlier lab versions
are intentionally left in the disposable local volume because index cleanup was
not approved.

### Search UX and lifecycle

Automated HTTP checks and owner browser checks verified controlled ranking,
no-match and empty-query states, malformed/repeated/oversized parameter
validation, pages 1–3 with no duplicates, query-preserving pagination links,
and navigation to the existing `/blog/[slug]` route. A missing local Shopify
environment caused an unrelated development overlay during the first oversized
query check. The owner approved copying only the four required Shopify/site
variables from the parent ignored environment; no values were displayed, the
worktree `.env` remained ignored with mode `600`, and a hard refresh passed
cleanly.

With loopback Elasticsearch stopped, search showed its honest unavailable state
while `/blog` and a detail page remained usable. After the healthy local service
returned, search results returned. Empty HTTP replies during startup were a
bounded local readiness delay; the container was healthy with zero restarts.

The owner separately approved and performed four one-document Studio exercises:

1. `search-lab-post-031` received a temporary title marker; a rebuild showed the
   new title/marker, and another rebuild verified the exact original title and
   absence of the marker after restoration.
2. `search-lab-post-032` received a temporary slug; search linked only the new
   route, then linked only the exact original route after restoration.
3. `search-lab-post-033` was unpublished; the next index had 104 documents and
   omitted it, then returned to 105 after the unchanged post was republished.
4. `search-lab-post-034` was deleted; the next index had 104 documents and
   omitted it. Studio history could not restore the deletion. A new dry-run
   showed exactly one create, 99 identical skips, and zero conflicts, so the
   owner separately approved the exact seed command to recreate only that
   recorded manifest document. Final source, index, search link, and corpus
   count returned to the expected state.

The deleted post's detail route remained a cached 404 even after a local dev
process restart. No cache files were deleted and no webhook or secret was used.
This is expected under the existing 3,600-second detail Data Cache revalidation
boundary and demonstrates that alias promotion does not invalidate Sanity detail
cache tags. The owner separately verified a different generated detail route
rendered normally.

### Failure recovery and cleanup posture

An injected count/ID-set validation failure ran only against test doubles. It
did not touch the live lab index, did not attempt alias promotion, and left
`commerce-sanity-posts-v1789329213050` serving valid results. A subsequent valid
full rebuild promoted `commerce-sanity-posts-v1789329295426` and retained the
former 105-document index.

After the complete observed-document guard was added, the final content-cleanup dry-run
reported 100 eligible, zero missing, and zero blocked documents. Every candidate
was an unchanged, unreferenced, lab-recorded root-level manifest document. No final cleanup apply is approved or performed;
all five baseline posts and all 100 corrected generated posts remain in Sanity.

The final dependency audit remains at the inherited stable baseline of seven
high and four moderate advisories. This task does not claim to remediate those
unrelated findings.

## Verified repository behavior versus proposed hosted architecture

### Verified here

- A pinned Elasticsearch `9.5.3` container runs locally on loopback only.
- Published Sanity posts are projected through an explicit strict mapping.
- Search uses English analysis, BM25-backed `multi_match`, field boosts, exact
  totals, deterministic tie-breakers, and bounded numbered pagination.
- Manual rebuild validates a complete fresh index before atomic alias promotion
  and retains the previous version.
- Seed and cleanup tooling defaults to dry-run and enforces deterministic,
  content-aware ownership boundaries.
- Existing Shopify search, Sanity webhooks, `/blog`, and `/blog/[slug]` behavior
  are not replaced by this search path.

### Not implemented or claimed

A hosted architecture would need authenticated and encrypted Elasticsearch,
private networking, production resource sizing, monitoring and alerting,
backups, access control, secret rotation, a reliable event/outbox or scheduled
synchronization strategy, retry/dead-letter handling, concurrency/versioning
rules, and an operational rollback policy. It might also use PIT with
`search_after`, language-specific analyzers, and zero-downtime index lifecycle
automation. None of those hosted concerns is implemented or validated by this
loopback learning experiment, and no production-scale performance claim follows
from approximately 100 synthetic posts.
