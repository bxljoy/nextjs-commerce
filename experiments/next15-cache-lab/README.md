# Next.js 15 cache lab

A local-only, deterministic fixture for comparing stable Next.js 15 cache layers. It is deliberately separate from the storefront because the storefront root layout reads a cart cookie and therefore renders dynamically without PPR.

## Run

From the repository root:

```bash
pnpm lab:cache
```

The runner removes only this fixture's `.next` directory, builds it, starts an in-memory origin on `127.0.0.1:4311`, starts Next on `127.0.0.1:4312`, performs assertions, and shuts both processes down. Override ports with `CACHE_LAB_ORIGIN_PORT` and `CACHE_LAB_APP_PORT`.

Expected observations:

1. `/isr` is classified `○` with a two-second revalidation period.
2. Repeated identical fetches reuse one persistent Data Cache result.
3. Different query keys do not collide.
4. The first request after TTL expiry receives stale data while background revalidation runs.
5. `revalidateTag` makes the next request fetch a fresh value.
6. Two cart cookies remain isolated and every cart read/mutation reaches the origin because it uses `cache: "no-store"`.
7. ISR retains the prior route output when regeneration fails and recovers after its controlled origin recovers.

The deliberate regeneration error printed during the failure experiment is expected; the runner must still finish with `PASS`.

## Manual Router Cache experiment

The automated runner verifies server caches only. To investigate the browser Router Cache, run the origin and built fixture manually, then navigate between `/` and `/isr` using soft navigation/back navigation while editing `data/isr.json`. Compare that with a hard reload. An external Route Handler invalidation changes server data but does not push a new RSC payload into an already-open tab.

Chrome DevTools MCP was unavailable in the implementation environment, so browser-specific behavior is documented as a manual experiment rather than reported as observed evidence.

## Why this fixture exists

- The storefront proves that dynamic rendering can still reuse Data Cache entries.
- This fixture removes the cart-cookie boundary to prove genuine Full Route Cache/ISR behavior.
- It uses a two-second TTL only to keep the experiment fast. Storefront TTLs remain 3600 seconds.
- It is not a deployable product, public API, or substitute for signed production webhooks.

Sources:

- https://nextjs.org/docs/15/app/guides/caching
- https://nextjs.org/docs/15/app/api-reference/functions/fetch
- https://nextjs.org/docs/15/app/api-reference/functions/revalidateTag
