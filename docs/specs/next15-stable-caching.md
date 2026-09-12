# Spec: Stable Next.js 15 storefront caching

## Status and intent

The owner approved a stable Next.js 15 implementation as a potential replacement
for the experimental PPR/`use cache` configuration on `main`. Work remains on
`learning/next15-stable-caching`; merging requires a separate decision after
local and Vercel Preview acceptance.

The goal is a conventional, production-capable stable implementation—not a
synthetic cache comparison lab and not a claim about another application's
architecture.

## Objective

Keep storefront appearance, Shopify behavior, published Sanity content, and
webhook contracts intact under an exact stable Next.js 15 release. Use explicit
cache policies without PPR, `cacheComponents`, `use cache`, private cache
directives, or canary-only invalidation APIs. Preserve private-cart isolation and
make the resulting behavior useful as interview material grounded in the real
application.

## Version and compatibility contract

- Pin the exact maintained stable release selected during compatibility review:
  Next.js `15.5.25`.
- Keep React, Geist, OpenNext, TypeScript, and integration dependencies within
  compatible peer ranges.
- Replace the incompatible `next-sanity` wrapper use with the official
  `@sanity/webhook@4.0.4` toolkit while preserving raw-body verification.
- Record dependency advisories rather than applying unrelated blanket upgrades.
  Any advisory introduced by this branch blocks merge; broader remediation stays
  separate.

## Cache contract

| Concern             | Stable implementation                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Shopify catalog     | Explicit fetch Data Cache with `force-cache`, a 3600-second TTL, and existing product/collection tags       |
| Sanity content      | Published client queries behind `unstable_cache`, keyed by accessor, query, client namespace, and arguments |
| Request memoization | Explain render-pass GET/HEAD memoization separately; do not rely on it for Shopify POST GraphQL             |
| Cart reads          | Explicit `cache: "no-store"`; read cookies outside persistent cache boundaries                              |
| Cart mutations      | Uncached GraphQL operations followed by supported stable path revalidation                                  |
| Webhooks            | Preserve authentication and public URLs; use stable one-argument `revalidateTag`                            |
| Full Route Cache    | Do not claim storefront ISR: the cookie-dependent root layout makes storefront routes dynamic               |
| Router Cache        | Document and manually verify browser behavior separately from server invalidation                           |

Use explicit finite one-hour TTLs for editorial and catalog reads. Time-based
revalidation may serve stale data while regeneration occurs; it does not run a
background timer in the absence of requests.

Avoid stacked persistent caches around the same request. Keep Sanity CDN reads
disabled and retain the webhook's three-second consistency wait.

## Rendering boundary

`app/layout.tsx` starts a cookie-dependent cart read and the navbar consumes it.
Without PPR, this request-specific dependency prevents shared Full Route Cache
entries for storefront routes. Cached non-personal Shopify and Sanity data can
still be reused while each request renders dynamically.

Do not move the cart into a new client-fetch architecture merely to obtain
static build markers. The dynamic build classification is expected and must be
reported honestly.

## Acceptance criteria

1. The branch pins Next.js `15.5.25` and contains no PPR, Cache Components,
   `use cache`, `use cache: private`, `cacheLife`, `cacheTag`, `updateTag`, or
   unsupported invalidation signatures.
2. Storefront UI, routes, Shopify operations, Sanity published-content behavior,
   and public webhook URLs remain unchanged.
3. Every Shopify catalog read has an explicit finite tagged policy; every cart
   read, creation, and mutation is explicitly `no-store`.
4. Sanity cache keys include closed-over GROQ query text and a namespace for
   project, dataset, API version, perspective, and CDN mode. Slugs remain
   function arguments.
5. Signed Sanity create/update/delete/unpublish events invalidate detail,
   indexes, metadata, sitemap data, cached misses, and both sides of a slug
   change. Invalid or malformed requests never invalidate data.
6. Shopify webhook authentication and its existing public HTTP response behavior
   remain unchanged.
7. Unit tests, formatting, TypeScript, and the production build pass. Storefront
   route classifications are documented without treating build success as
   external integration proof.
8. A Vercel Preview verifies real Shopify catalog/search/cart flows and real
   signed Sanity events using Preview-only secrets and a temporary branch
   webhook.
9. Browser navigation and hard reload confirm the documented Router Cache limit:
   a server webhook does not live-update an already-open tab.
10. The interview guide describes the real implementation, evidence, limits,
    trade-offs, and remaining merge gates without synthetic lab claims.

## Files and commands

- Spec: `docs/specs/next15-stable-caching.md`
- Plan/checklist: `tasks/plan.md`, `tasks/todo.md`
- Interview notes: `docs/learning/next15-stable-caching.md`
- Runtime seams: `next.config.ts`, `lib/shopify/index.ts`,
  `lib/sanity/index.ts`, cart actions, root layout, and webhook routes.

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm audit --audit-level high
```

Use the Node test runner for cache-policy and webhook regression tests. Use a
real Vercel Preview for service behavior and a real browser for Router Cache
behavior. Do not treat formatting, build output, or mocked requests as proof of
external end-to-end correctness.

## Boundaries

- Always: keep secrets out of logs/files, preserve signed webhooks, isolate
  Preview configuration, and distinguish automated from external evidence.
- Ask first: new dependencies, significant cart architecture changes, external
  dataset edits, protection changes, pushing, or merging.
- Never: modify Production webhooks during Preview testing, expose private carts
  through shared caching, silently change service semantics, or weaken tests to
  obtain a green build.
- Out of scope: Redis, Elasticsearch, UI redesign, draft mode, platform
  migration, and unrelated dependency modernization.

## References

- https://nextjs.org/docs/15/app/guides/caching
- https://nextjs.org/docs/15/app/api-reference/functions/fetch
- https://nextjs.org/docs/15/app/api-reference/functions/unstable_cache
- https://nextjs.org/docs/15/app/api-reference/functions/revalidateTag
- https://nextjs.org/docs/15/app/api-reference/functions/revalidatePath

Versioned documentation is the starting point; validate signatures and runtime
behavior against the exact installed patch.
