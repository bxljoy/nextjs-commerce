# Plan: Stable Next.js 15 caching comparison

Status: ready for review; documentation only so far.

Spec: `docs/specs/next15-stable-caching.md`.
Branch: `learning/next15-stable-caching`.
Baseline: main at `3b38dcd`; capture the actual baseline again before implementation.
Previous completed plan: `tasks/archive/sanity-webhook/plan.md`.

## 1. Establish baseline and compatible stable version

- Record current tests, build route classifications, data reads, and webhook/cart behavior.
- Select an exact patched stable 15.x version from registry metadata and official advisories.
- Check React/next-sanity/Geist/OpenNext/Node peers and supported APIs. Identify uses of `use cache`, `cacheLife`, `cacheTag`, `updateTag`, private cache, and `revalidateTag` profiles.
- Record current audit findings and distinguish baseline risks from migration regressions.
- Likely files: package manifest, lockfile, comparison notes.
- Gate: no version changes until a compatible version and migration mapping are recorded. Ask if supporting dependency changes are needed.

### Compatibility findings — awaiting dependency approval

- Registry resolves stable Next.js 15 to `15.5.25`. Its declared peers accept the current React 19.0.0 and Node 22.15.0; installed Geist and OpenNext peer ranges also accept it. Advisory verification remains outstanding.
- Installed `next-sanity@13.3.4` requires Next.js 16 and React 19.2.3+. Version 12 also requires Next.js 16; version 11 supports Next.js 15 but requires Sanity client 7, rather than the installed client 8.
- The application's only remaining next-sanity import is `parseBody` in the Sanity webhook route.
- Proposed minimal adjustment: replace next-sanity with a direct dependency on the official `@sanity/webhook@4.0.4` toolkit (already present transitively), keep client 8, and implement raw-body verification/JSON parsing with the existing consistency wait. No custom signature algorithm. Require real signed-payload regression tests.
- This supporting dependency change needs owner approval under the spec. No runtime code, package manifest or lockfile has been changed.
- Baseline `pnpm test`: seven tests and formatting passed. No claim of migration completion or security clearance.

## 2. Specify regression tests before the coordinated migration

- Test cached catalog options versus uncached cart queries/mutations.
- Test Sanity argument-specific keys, published-only reads, page/post tags and cached misses.
- Extend webhook tests to cover malformed payloads and version-compatible invalidation wiring; preserve existing seven tests.
- Record production HTTP/browser procedures for cart isolation and cache behavior.
- Likely files: existing webhook tests plus focused cache-policy tests near each integration.
- Gate: record expected red results without removing existing assertions.

## 3. Migrate cache boundaries in small, coordinated steps

The version pin and removal of canary-only APIs form one compatibility unit. Intermediate migration work is not deployable until the build gate passes; do not push broken intermediate states.

1. Add explicit Shopify catalog fetch options and `no-store` cart policies. Include body/query/sort variables in cache identity. Keep transforms and GraphQL operations unchanged.
2. Replace Sanity function directives with `unstable_cache` wrappers. Pass slug as an argument; keep configuration guards and dynamic APIs outside cached callbacks. Preserve type tags and the uncached Sanity origin behind the wrapper.
3. Replace private cart caching with uncached reads. Map cart Server Action refresh and both webhook invalidation calls to the selected stable API while retaining external response/security contracts.
4. Pin the stable Next.js package, update the lockfile through pnpm, and remove experimental PPR/useCache configuration. Check `inlineCss` support independently rather than assume compatibility.
5. Retain the cookie-dependent root layout and existing UI. Record dynamic route classifications honestly.

- Files by seam: `lib/shopify/index.ts`; `lib/sanity/index.ts`; `components/cart/actions.ts`; webhook route/adapters; `next.config.ts`; package manifest/lockfile.
- Gate: unit tests, formatting, typecheck and build pass as a complete migration. No cart data in shared cache. No residual canary-only imports/directives.

## 4. Run controlled caching experiments

Use `pnpm build && pnpm start`, not development HMR, to draw production-cache conclusions.

| Experiment              | Procedure                                                                                 | Required observation                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Data Cache              | Read identical query twice with controlled origin counters, then change query arguments   | Cached result reused; changed arguments stay isolated                                     |
| Time-based revalidation | Warm a short-TTL test entry, update controlled origin, wait past TTL, request twice       | Distinguish stale first response from eventual regenerated value                          |
| Webhook invalidation    | Warm detail/index/miss, change fixture, deliver signed type event                         | Fresh subsequent server reads, including new slug and removed old slug                    |
| Cart isolation          | Use two cookie jars and mutate only one                                                   | No cross-user lines/totals; cart origin requests are uncached                             |
| Router Cache            | Warm browser navigation, deliver webhook, compare back/soft navigation with refresh       | Explain why a webhook does not push updates to an existing tab                            |
| ISR                     | Use cookie-free isolated Next fixture with literal route `revalidate` and controlled data | Static build classification and actual regenerated HTML/RSC; test stale-on-origin-failure |

Use controlled fixtures/test doubles for automated origin changes; do not mutate production Sanity/Shopify data to prove caching. Avoid logging credentials, full payloads or cart IDs. Exact fixture packaging is a review checkpoint: reuse dependencies where possible; no new production route without approval.

## 5. Write the interview comparison

Create `docs/learning/next15-caching-comparison.md` covering:

- Cache owner, key, lifetime, invalidation and isolation for each layer.
- PPR rendering versus cached data/functions, and why Suspense alone is not PPR.
- Cached data inside dynamic SSR versus full-route ISR.
- Time-based stale-while-revalidate versus explicit on-demand expiry.
- React render-pass memoization versus persistent caches, including POST GraphQL.
- What Redis could solve separately (shared application cache, rate limits, sessions), without assuming Keystone's use case.
- A two-minute explanation and evidence-backed answers to common interview questions.

Gate: every claim points to an observed result or a documented limitation; no invented latency or cache-hit numbers.

## 6. Optional Vercel Preview validation

After local acceptance and owner approval to push:

- Deploy only the learning branch. Do not merge into main automatically.
- Verify Preview environment values and stable branch URL.
- If testing content events, create a temporary branch-specific signed Sanity webhook. Existing Production webhook must remain untouched.
- Preview commonly shares the production dataset: use approved test content or a separate fixture/dataset, not accidental edits to live pages.
- Check preview storefront, cart isolation, webhook authentication and cache refresh.
- Remove temporary webhook when done; preserve notes and learning branch as comparison artifacts.

## Completion and rollback

Complete implementation only when local gates and experiment evidence pass. Preview validation is recorded separately, not implied by a build. Preserve known audit limitations explicitly.

Rollback is returning to unchanged `main`; no production rollout is planned. Do not reuse the previous webhook feature's merge-to-production checklist for this learning branch.
