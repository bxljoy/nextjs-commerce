# Stable Next.js 15 caching — interview notes

## What this branch implements

This branch is a potential replacement for the experimental configuration on
`main`. It keeps the storefront UI and service contracts while using the normal
stable Next.js 15 APIs.

| `main` baseline                                            | Stable implementation                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Next `15.6.0-canary.60`                                    | Next `15.5.25`                                                                        |
| Experimental PPR and `use cache`                           | No PPR or Cache Components configuration                                              |
| `cacheLife`, `cacheTag`, `updateTag`, `use cache: private` | Fetch Data Cache, `unstable_cache`, `revalidateTag`, `revalidatePath`, and `no-store` |
| Partial prerendering for eligible route shells             | Dynamic storefront rendering because the root layout reads the cart cookie            |

The stable implementation deliberately separates **how a route renders** from
**whether its non-personal data can be reused**.

## Cache-layer mental model

| Layer                     | What it stores                                     | Lifetime/scope                        | Storefront behavior                                                   |
| ------------------------- | -------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| React request memoization | Repeated GET/HEAD fetches during one server render | One render pass                       | Does not automatically memoize Shopify POST GraphQL requests          |
| Data Cache                | Fetch responses and `unstable_cache` results       | Persistent; application TTL is 1 hour | Shopify catalog fetches and published Sanity query results            |
| Full Route Cache          | Static route HTML and RSC payloads                 | Build and ISR lifecycle               | Storefront routes opt out because the root layout reads a cart cookie |
| Router Cache              | Visited or prefetched RSC segments                 | Browser session/framework heuristics  | A webhook cannot push fresh content into an already-open browser tab  |
| Browser/CDN cache         | HTTP response representations                      | HTTP/platform policy                  | Separate from Next's server Data Cache and Full Route Cache           |

### Dynamic rendering can reuse cached data

`app/layout.tsx` starts `getCart()`, and `getCart()` reads `cookies()`. Without
PPR, that request-specific dependency makes the storefront routes dynamic. The
server renders them per request rather than sharing one route-level HTML/RSC
entry between users.

That does not disable explicit Data Cache entries. A dynamic render can still
reuse shared catalog and editorial data while fetching the current user's cart
with `no-store`.

### PPR, Suspense, and data caching are different

- PPR stores a static route shell and streams dynamic regions into it.
- Suspense controls streaming boundaries but does not create a stored static
  shell by itself.
- A cached data request can be reused by either a static or dynamic render.
- Removing PPR therefore changes the rendering strategy, not the requirement to
  classify shared and private data correctly.

## Shopify implementation

`lib/shopify/index.ts` requires every GraphQL call site to select one of two
policies from `lib/shopify/cache-policy.ts`.

### Shared catalog data

Product and collection reads use:

```ts
{
  cache: "force-cache",
  next: {
    revalidate: 3600,
    tags: [/* product and/or collection tags */],
  },
}
```

The GraphQL query and variables remain in the POST body constructed by
`shopifyFetch`. Product handles, collection handles, search terms, sort keys,
reverse ordering, and pagination variables therefore remain part of the actual
request rather than being hidden in a shared application-level result cache.

Shopify webhooks invalidate the existing product or collection tags. The
one-hour TTL is a fallback for missed events, not a timer that refreshes data
when no request occurs.

### Private cart data

Cart creation, reads, and mutations all use:

```ts
{
  cache: "no-store";
}
```

The cart ID is read from the request cookie outside every persistent cache
boundary. No cart response can enter the shared Data Cache. Cart Server Actions
call `revalidatePath("/", "layout")` after mutations so the next server render
reads the current uncached cart and reconciles optimistic UI state.

This policy is intentionally explicit at each call site. A cached transport
default would make it too easy for a future cart operation to inherit shared
caching accidentally.

## Sanity implementation

The application reads Sanity through `@sanity/client`, so it wraps each query
shape with stable Next.js 15's `unstable_cache` rather than assuming the client
uses Next's extended `fetch` contract.

Each persistent key includes:

1. The accessor type (`page`, `pages`, `post`, or `posts`).
2. A namespace containing project ID, dataset, API version, perspective, and
   CDN mode.
3. The exact GROQ query text captured by the cached callback.
4. Function arguments such as the requested slug, which Next includes in the
   invocation key.

This prevents entries surviving incorrectly across a query or Sanity client
configuration change. Page and post entries use separate coarse tags and a
one-hour fallback TTL. Configuration guards remain outside the cached callbacks
so a build without Sanity variables cannot persist an empty fallback.

The client remains published-only with `useCdn: false`. The signed webhook:

1. Reads the untouched raw request text.
2. Verifies it with `@sanity/webhook` before JSON parsing.
3. Waits three seconds after a valid signature for Content Lake consistency.
4. Invalidates the `pages` or `posts` tag with stable one-argument
   `revalidateTag`.

Coarse type tags deliberately cover detail pages, indexes, metadata, sitemap
entries, cached misses, unpublishes/deletes, and both sides of a slug rename.

## Freshness behavior

- **Time-based revalidation:** after the one-hour TTL, a request may receive the
  stale value while Next refreshes it for a later request.
- **Webhook invalidation:** expires the affected server Data Cache entries so a
  subsequent server request obtains current content.
- **Router Cache:** an existing tab may reuse an older RSC payload during soft
  navigation. A hard reload obtains server state again; the product requirement
  does not require live updates to already-open pages.
- **Failures:** the service clients and route error boundaries retain their
  existing behavior. External Preview verification is required before claiming
  end-to-end cache freshness.

## Verification evidence

Local automated checks cover:

- Real Sanity signature generation and verification against raw body text.
- Missing/invalid signatures, malformed payloads, and unsupported types.
- Page/post tag selection.
- Sanity cache namespace, query identity, slug arguments, TTL, and tags.
- Shopify catalog versus private/mutation cache policies.
- TypeScript compatibility and a production build under Next `15.5.25`.

The implementation retains the three-second consistency wait, but the direct
parser tests disable that delay to remain fast and do not claim timing coverage.

The production build classifies storefront content routes as dynamic (`ƒ`)
because the root layout reads the cart cookie. That classification is expected;
it does not prove or disprove reuse of the underlying Data Cache entries.

On 2026-09-12, the owner manually verified the following against the Vercel
Preview branch alias:

- Real Shopify product, collection, search, sort, cart, and mutation behavior.
- Cart isolation across two browser sessions.
- Real signed Sanity create/update/delete/unpublish and slug-change events,
  including dependent indexes, metadata, and sitemap output.
- Browser soft-navigation, back-navigation, and hard-reload behavior.

The Preview webhook used a separate Sanity signature secret plus a Vercel
automation-bypass header because Deployment Protection otherwise rejected the
request before Next.js. The temporary webhook was disabled after validation.
These are owner-attested external checks, not an agent-recorded browser run.

The stable dependency diff introduces no new advisory relative to `main` and
removes 12 findings. Eleven transitive findings remain disclosed for separate
remediation.

## Two-minute interview answer

> I migrated a commerce storefront from experimental Next.js 15 PPR and Cache
> Components APIs to stable Next.js 15. I made the cache boundary explicit at
> each integration: Shopify catalog POST requests use the Data Cache with a
> finite TTL and tags, Sanity client queries use `unstable_cache` with query,
> configuration, and argument-aware keys, and every cart operation is
> `no-store`.
>
> The important distinction is rendering versus data caching. The root layout
> reads a cart cookie, so without PPR the storefront renders dynamically for
> each request. Those renders can still reuse non-personal catalog and editorial
> data. Private cart state never enters a persistent shared cache.
>
> Webhooks invalidate server tags, but they do not push a new RSC payload into
> an existing browser Router Cache. That is acceptable here because editorial
> changes only need to appear on the next visit or reload. Before merging, I
> verify the real Shopify and Sanity flows in an isolated Vercel Preview rather
> than treating a successful build as end-to-end proof.

## Common interview questions

### Why not export `revalidate = 3600` on every route?

The root layout still reads a user-specific cookie. A route-level setting cannot
make that personalized output safe to share. Cache the non-personal data and
render the route dynamically.

### Why `unstable_cache` for Sanity but fetch options for Shopify?

The application directly owns Shopify's `fetch` call. Sanity is accessed through
a client abstraction, so a function-result cache is the explicit boundary.

### Why can catalog POST requests be cached while cart POST requests are not?

HTTP method alone does not express application privacy. Catalog GraphQL
operations are shared reads and receive an explicit finite Data Cache policy.
Cart operations contain user-specific state and are explicitly `no-store`.

### Why include query text and client configuration in Sanity keys?

`unstable_cache` cannot infer the values of variables closed over by a callback.
Without explicit key parts, changing a GROQ query, dataset, project, perspective,
or API version could reuse an entry created under the old configuration.

### Why use coarse Sanity tags?

One type tag safely covers lists, details, metadata, sitemap entries, cached
misses, deletes, and old/new slugs. More granular tags are useful only if content
volume or invalidation cost makes that additional contract worthwhile.

### Would you merge this branch?

It passed local gates, independent review, and owner-attested Vercel Preview
checks, so it is technically a merge candidate. The owner chose not to merge it
at this time, preserving both the experimental `main` baseline and this stable
implementation as interview material. Remaining dependency advisories stay in a
separate remediation scope.

## Official sources

- https://nextjs.org/docs/15/app/guides/caching
- https://nextjs.org/docs/15/app/api-reference/functions/fetch
- https://nextjs.org/docs/15/app/api-reference/functions/unstable_cache
- https://nextjs.org/docs/15/app/api-reference/functions/revalidateTag
- https://nextjs.org/docs/15/app/api-reference/functions/revalidatePath
- https://github.com/sanity-io/webhook-toolkit#usage-with-nextjs
- https://github.com/vercel/next.js/releases/tag/v15.5.24
