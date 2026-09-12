# Next.js 15 caching comparison — interview notes

## What this branch proves

This branch is a learning comparison, not a production recommendation and not a claim about Keystone's architecture.

| Baseline `main`                                             | This branch                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Next `15.6.0-canary.60`                                     | Next `15.5.25` stable                                                                 |
| Experimental PPR and `use cache` enabled                    | No experimental Next configuration                                                    |
| `use cache` / `use cache: private`, `cacheTag`, `cacheLife` | Fetch Data Cache, `unstable_cache`, `cache: "no-store"`                               |
| Product/content details build as partial prerender routes   | Cookie-reading root layout makes storefront routes dynamic                            |
| Sanity webhook used `next-sanity` wrapper                   | Same signed contract using its underlying official `@sanity/webhook` toolkit directly |

The UI, Shopify operations, published Sanity perspective, cache tags and public webhook URLs are unchanged.

## Cache-layer mental model

| Layer                     | What is cached                                         | Typical key                                                 | Lifetime                                     | Invalidation/isolation here                                                          |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| React request memoization | One repeated fetch during one server render            | URL + fetch options                                         | One render pass                              | Automatic only for GET/HEAD-style reads; Shopify POST GraphQL is not render-memoized |
| Data Cache                | Fetch responses and `unstable_cache` results           | Fetch request identity, or function + key parts + arguments | Persistent across requests; one-hour app TTL | Shopify product/collection tags; Sanity page/post tags                               |
| Full Route Cache          | Rendered HTML and RSC payload for static routes        | Route/path                                                  | Build plus ISR revalidation                  | Storefront opts out via cart cookies; cache lab `/isr` uses two seconds              |
| Router Cache              | RSC segments already visited/prefetched in one browser | Client route segments                                       | Session and framework heuristics             | Soft navigation may reuse it; hard reload or supported refresh obtains server state  |
| Browser HTTP cache/CDN    | HTTP response representation                           | URL + HTTP cache rules                                      | Response/platform policy                     | Separate from the four Next-specific layers above                                    |

### Dynamic rendering does not mean uncached data

`app/layout.tsx` calls `getCart()`, which reads `cookies()`. On stable Next.js 15 this opts the storefront routes out of the Full Route Cache, so `pnpm build` classifies them as `ƒ`.

That does **not** disable the Data Cache. Product/collection POST fetches remain explicitly cached, and Sanity reads remain persistently cached through `unstable_cache`. Each request renders the route, but can reuse shared non-personal data.

### PPR and `use cache` solve different problems

- **PPR is a rendering strategy:** a static shell can be sent while dynamic regions stream behind Suspense boundaries.
- **`use cache` marks a function/component cache boundary:** it controls reuse of its result.
- Suspense alone is not PPR; without PPR it can stream a dynamic response, but it does not create a stored static shell.
- The stable comparison removes both mechanisms so their effects are not conflated.

## Implementation decisions

### Shopify

`shopifyFetch` requires every caller to choose a cache policy:

- Catalog reads: `cache: "force-cache"`, `next.revalidate: 3600`, and product/collection tags.
- Cart reads, cart creation and mutations: `cache: "no-store"`.
- Query variables stay in the GraphQL request body. The cache lab verifies that controlled request keys do not collide; Next's versioned documentation does not explicitly document every fetch-key field, so do not overstate the internal key algorithm.
- Cart Server Actions call `revalidatePath("/", "layout")` so the uncached cart read replaces optimistic state using an API available in stable Next.js 15.

A generic transport default would be dangerous: accidentally caching a mutation or cart response could leak personal state. Requiring an explicit policy makes the security boundary visible in code review.

### Sanity

`@sanity/client` does not route through Next's extended fetch in a way the application controls, so each query shape is wrapped with `unstable_cache`:

- Key parts distinguish page, pages, post and posts queries.
- Slugs are callback arguments; Next.js includes function arguments in the cache key.
- Page/post tags deliberately remain coarse to cover detail routes, indexes, metadata, cached misses, sitemap data, deletes and slug changes.
- The environment guard remains outside the cached callback so a misconfigured build does not persist an empty fallback.
- The client remains published-only with `useCdn: false`.

The webhook verifies the raw request text before JSON parsing, waits three seconds after a valid signature for Content Lake consistency, then calls the one-argument stable `revalidateTag(tag)`.

### Time-based versus event-based freshness

A one-hour TTL is a fallback, not a polling schedule. No request means no regeneration.

- **TTL:** the first request after expiry can receive stale data while revalidation runs in the background. A later request receives the refreshed value.
- **Webhook/tag:** the controlled Next 15.5.25 lab observed that the first request after `revalidateTag` fetched the new value.
- **Failure:** failed ISR regeneration retained the prior route output. Once the origin recovered, a later request triggered successful regeneration.

## Measured evidence

### Storefront build

`pnpm build` on stable `15.5.25` completed successfully. It classified all storefront content routes as dynamic (`ƒ`) because the root layout reads the cart cookie. Static Open Graph and robots routes remained `○`.

The prior canary build classified parameterized page, post, product and collection routes as partial prerender (`◐`), while still identifying cookie-dependent or request-dependent routes as dynamic.

### Automated cache lab

Run:

```bash
pnpm lab:cache
```

Observed in a production build:

1. `/isr` built as `○` with `Revalidate 2s`.
2. Two identical controlled reads produced one origin hit.
3. Keys `A` and `B` had independent origin counters.
4. After TTL expiry, the first response was stale and a later response contained the new origin value.
5. After tag invalidation, the next read contained the new value.
6. Cookie jars `user-a` and `user-b` retained different cart items; repeated cart reads incremented origin hits because they were uncached.
7. A controlled ISR origin error logged a regeneration failure while clients kept the previous HTML; recovery produced the new HTML.
8. Removing the fixture `.next` directory is required for deterministic runs because the Data Cache persists between production server restarts/build attempts.

The two-second TTL is experiment-only; storefront TTLs remain one hour.

### Automated policy and security tests

`pnpm test` runs 12 Node tests covering:

- Real Sanity signature generation and verification against unmodified raw text.
- Missing/invalid signatures, malformed payloads and unsupported types.
- Page/post tag selection.
- Sanity cache boundaries, arguments, TTL and tags.
- Shopify shared catalog versus private/mutation policies.

### Evidence not claimed

Chrome DevTools MCP was unavailable (no configured MCP servers), so Router Cache behavior remains a documented manual browser exercise. A Vercel Preview and real external Sanity events are also not yet verified on this branch. Unit/component evidence shows that create/update/delete events share the same type-tag path, but it is not labeled an external end-to-end test.

## Router Cache interview explanation

A Sanity webhook executes on the server. It can invalidate Data Cache entries and affect future server renders, but it cannot push a new RSC payload into an already-open browser tab. Soft navigation or back navigation can reuse the browser's Router Cache. A hard reload requests server state again; a Server Action can also coordinate supported path refresh behavior.

This matches the product requirement: editorial changes only need to appear on the next visit/reload, not live-update an open page.

## Where Redis and Elasticsearch fit

Redis is not automatically a replacement for the Next Data Cache. It is useful when the application needs explicit cross-service ownership, portable cache keys, shared sessions, rate limits, locks, queues/pub-sub, or cache data used outside Next. Adding Redis on top of Next caching without a clear owner creates two TTLs and two invalidation paths.

Elasticsearch is primarily a search/read index: relevance, analyzers, faceting and large-scale querying. Its indexed data has freshness and synchronization concerns, but calling it a cache hides its real consistency model.

Ask Keystone how they divide responsibility: which layer owns product/content/search freshness, what is acceptable staleness, and how invalidation propagates across instances.

## Two-minute interview answer

> I compared the same storefront under two Next.js 15 caching models. On the canary branch, PPR produces a static shell with dynamic regions, and `use cache` defines function boundaries. On the stable branch, I made each cache decision explicit: shared Shopify catalog fetches use the Data Cache with finite TTLs and tags, Sanity client queries use argument-keyed `unstable_cache`, and every cart operation is `no-store`.
>
> The important lesson was that rendering and data caching are separate. Because my root layout reads a cart cookie, stable Next renders storefront routes dynamically, but those renders still reuse cached catalog and editorial data. I used a separate cookie-free fixture to demonstrate real ISR, including stale-while-revalidate, tag invalidation, and retaining stale HTML when regeneration fails.
>
> I also treat the browser Router Cache separately: a CMS webhook refreshes server caches but does not live-update an existing tab. For private state, correctness and isolation beat hit rate. If Redis were introduced, I would first define which layer owns TTL and invalidation rather than stack another cache blindly.

## Questions I can answer

### Why not put `revalidate = 3600` on every route?

The cookie-reading root layout still makes storefront routes dynamic. Route configuration cannot turn request-specific output into safe shared HTML. Cache the non-personal data instead.

### Why `unstable_cache` for Sanity but fetch options for Shopify?

The application owns Shopify's fetch call. Sanity is accessed through its client, so a function-result cache is the explicit stable boundary.

### Why are POST GraphQL catalog reads cacheable?

They are semantically reads, and Next's server fetch supports explicit Data Cache policy. React render memoization is a different layer and does not automatically memoize POST. Cart POST operations remain strictly `no-store`.

### Why coarse tags?

They cover list/detail/metadata/sitemap dependencies and old/new slugs safely. More selective tags are worthwhile only when content volume or invalidation cost justifies the extra contract.

### What happens when regeneration fails?

The lab observed that the prior ISR output remains available. Recovery happens on a later revalidation attempt; tests should use bounded condition polling rather than assume regeneration finishes in a fixed number of milliseconds.

### Would you ship the stable branch?

Not automatically. It is a comparison branch, still needs Preview/browser checks, and `pnpm audit` reports 11 transitive findings (7 high, 4 moderate) in sharp/PostCSS/nanoid paths. Dependency remediation belongs in a separate reviewed change.

## Official sources

- https://nextjs.org/docs/15/app/guides/caching
- https://nextjs.org/docs/15/app/api-reference/functions/fetch
- https://nextjs.org/docs/15/app/api-reference/functions/unstable_cache
- https://nextjs.org/docs/15/app/api-reference/functions/revalidateTag
- https://nextjs.org/docs/15/app/api-reference/functions/revalidatePath
- https://github.com/sanity-io/webhook-toolkit#usage-with-nextjs
- https://github.com/vercel/next.js/releases/tag/v15.5.24
