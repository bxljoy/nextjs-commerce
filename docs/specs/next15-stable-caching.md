# Spec: Stable Next.js 15 caching comparison

## Status and intent

Scope confirmed with the owner; implementation has not started.

This is an interview-learning exercise, not a proposed production downgrade or a claim about Keystone's internal architecture. Preserve `main` as the Next.js 15 canary PPR/`use cache` baseline. Implement the comparison on `learning/next15-stable-caching`, with no automatic merge to main.

The baseline is experimental Next.js 15, not Next.js 16's stable Cache Components configuration.

## Objective

Explain and demonstrate the differences between request memoization, Data Cache, Full Route Cache/ISR, client Router Cache, and PPR/function-cache boundaries. Keep storefront appearance, Shopify operations, published Sanity content, and webhook authentication intact.

## Version and compatibility gate

Before implementation, select and pin an exact maintained, patched stable Next.js 15 release. Verify registry metadata, official advisories, and compatibility with React, next-sanity, Geist, OpenNext, Node and TypeScript. Do not guess the newest patch or automatically downgrade supporting packages. Stop for a scope decision if a compatible secure combination cannot be established.

Existing dependency advisories are not resolved by these documents. Record whether the selected version fixes the baseline Next.js advisory and identify any remaining release blockers. Do not blanket-run audit fixes.

## Cache contract

| Concern             | Comparison implementation                                                                                      | Evidence                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Shopify catalog     | Explicit fetch Data Cache with positive `next.revalidate` and existing product/collection tags                 | Repeated server requests reuse catalog data; query/sort arguments remain distinct                 |
| Sanity content      | Published client queries behind `unstable_cache`, keyed by query arguments and tagged by pages/posts           | Detail, index, metadata and sitemap share valid cached content; slug values do not collide        |
| Request memoization | Optional React `cache` around repeated identical reads within a render                                         | Explain why this is not persistent caching and why POST GraphQL is not automatically GET-memoized |
| Cart reads          | Explicit `cache: "no-store"`; read cookies outside shared cache boundaries                                     | Two independent cookie jars never share cart data                                                 |
| Cart mutations      | Uncached GraphQL operations; refresh affected UI using supported stable Server Action invalidation             | Add, quantity, delete and checkout behavior retained                                              |
| Webhooks            | Retain signature verification and existing external URLs; use selected version's supported `revalidateTag` API | First new server read after successful on-demand invalidation is fresh                            |
| Full Route Cache    | Only static-eligible routes get full-route ISR                                                                 | Build classification plus regeneration evidence, not a `revalidate` export alone                  |
| Router Cache        | Document separate browser behavior                                                                             | Compare soft navigation/back navigation, `router.refresh()` and hard reload                       |

Use explicit finite TTLs (initially 3600 seconds for editorial/catalog reads). Short experimental TTLs belong in an isolated lab or explicit test configuration, not a silently weakened production default. Time-based revalidation may serve a stale response while regeneration occurs; it does not mean a timer fetches fresh data in the background.

Avoid stacked persistent caches around the same request. Keep Sanity CDN disabled and retain the webhook's consistency wait. Check the selected version's signatures rather than assuming `updateTag`, `cacheLife`, or two-argument `revalidateTag` exist.

## Rendering boundary: an important limitation

`app/layout.tsx` currently starts a cookie-dependent cart read and the navbar consumes it. Without PPR, that dynamic dependency can prevent Full Route Cache eligibility throughout the storefront. Cached data can still be reused while routes render on each request.

The main comparison must preserve that behavior and explain the result honestly. Do not move the cart into a new client-fetch API merely to obtain static build markers.

For genuine route-level ISR evidence, use a small separate learning fixture with a cookie-free root layout and deterministic content source. It is not part of the deployed storefront or a UI redesign. Confirm its packaging during planning review; if it would require new dependencies or production routes, ask first. A conceptual example alone must not be reported as a verified ISR experiment.

## Acceptance criteria

1. Main and its deployed production site remain unchanged.
2. The comparison pins an exact stable Next.js 15 version and removes reliance on PPR, `useCache`, `use cache: private`, Cache Components tags/lifetimes, and unsupported Server Action APIs.
3. Catalog/content reads have explicit cache policy and preserve argument-specific results, tags and published-only behavior.
4. Cart reads and writes cannot enter the shared Data Cache; independent-user and mutation tests pass.
5. Signed Sanity create/update/delete/unpublish events invalidate details, cached misses, indexes, metadata and sitemap data; a slug rename refreshes both old and new lookups. Shopify webhook authentication and public response behavior remain unchanged.
6. Repeatable production-mode experiments distinguish Data Cache reuse from Full Route Cache reuse and request memoization.
7. A static-eligible isolated fixture demonstrates time-based ISR, including stale-while-revalidate and recovery from origin failure.
8. Browser experiments document Router Cache limitations after external webhook invalidation; existing tabs are not promised immediate freshness.
9. A short interview guide includes measured results, commands, trade-offs, and uncertainty rather than claimed knowledge of Keystone's deployment.

## Structure, style and commands

- Spec: `docs/specs/next15-stable-caching.md`
- Plan/checklist: `tasks/plan.md`, `tasks/todo.md`
- Prior completed webhook plan: `tasks/archive/sanity-webhook/`
- Proposed learning notes: `docs/learning/next15-caching-comparison.md`
- Existing runtime seams: `next.config.ts`, `lib/shopify/index.ts`, `lib/sanity/index.ts`, cart actions, root layout, and webhook routes.

Keep existing TypeScript named exports and Prettier style. Prefer explicit cache policy over a universal cached transport: a generic transport that caches cart mutations is unacceptable.

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm start
pnpm audit --audit-level high
```

Use the built-in Node test runner for policy tests, production-mode HTTP checks for caching, and a real browser for Router Cache behavior. Add repeatable experiment commands during implementation; record failures as well as passes. Do not treat formatting or a passing build as proof of cache correctness.

## Boundaries

- Always: keep secrets out of logs/files, preserve signed webhooks, scope preview configuration separately, test before claiming behavior.
- Ask first: new dependencies, significant cart architecture changes, external dataset edits, protection changes, or merging this learning branch.
- Never: modify production webhooks, expose private carts through shared caching, silently change service semantics, or weaken tests to accommodate a downgrade.
- Out of scope: Redis, Elasticsearch, UI redesign, draft mode, platform migration, full AWS deployment validation, and unrelated dependency modernization.

## References

- https://nextjs.org/docs/15/app/guides/caching
- https://nextjs.org/docs/15/app/api-reference/functions/fetch
- https://nextjs.org/docs/15/app/api-reference/functions/unstable_cache
- https://nextjs.org/docs/15/app/api-reference/functions/revalidateTag

Versioned documentation is the starting point; validate signatures and runtime behavior against the exact installed patch.
