# Plan: Stable Next.js 15 storefront caching

Status: local implementation, verification, and independent review complete;
Vercel Preview and browser checks remain.

Spec: `docs/specs/next15-stable-caching.md`.
Branch: `learning/next15-stable-caching`.
Baseline: `main` at `3b38dcd`.
Previous completed plan: `tasks/archive/sanity-webhook/plan.md`.

## 1. Establish the compatible stable version

- Capture baseline tests, build classifications, integration behavior, and cache
  directives.
- Select an exact patched stable Next.js 15 release from registry metadata and
  official advisories.
- Check React, Sanity, Geist, OpenNext, Node, and TypeScript compatibility.
- Record audit findings separately from migration regressions.

### Result

- Next.js is pinned to `15.5.25`; React 19.0.0, Geist, and OpenNext accept it.
- Installed `next-sanity@13.3.4` required Next.js 16 and was used only for webhook
  parsing. The owner approved direct `@sanity/webhook@4.0.4` usage while keeping
  `@sanity/client@8.4.0`.
- The selected Next patch includes the critical fixes released in `15.5.24`.
- The stable lockfile audit reports 11 transitive findings (7 high, 4
  moderate) in sharp/PostCSS/nanoid paths. The `main` lockfile reports 23 (12
  high, 11 moderate), including additional Next.js, js-yaml, and smol-toml
  advisories. This branch introduces no new advisory and removes 12 findings,
  but broader remediation remains separate; do not apply a blanket audit fix.

## 2. Add regression tests before migration

- Test explicit shared catalog versus private cart policies.
- Test Sanity TTL, tags, slug argument forwarding, query identity, and client
  configuration namespace.
- Test real raw-body Sanity signatures, malformed payloads, unsupported types,
  and invalidation selection.
- Preserve all existing assertions and observe new tests fail before production
  changes.

## 3. Migrate stable cache boundaries

1. Make catalog calls explicitly `force-cache` with a 3600-second TTL and
   existing product/collection tags.
2. Make cart reads, creation, and mutations explicitly `no-store`; keep cookie
   reads outside persistent cache boundaries.
3. Replace Sanity function directives with `unstable_cache`; include accessor,
   query text, client namespace, and invocation arguments in cache identity.
4. Preserve published-only Sanity reads, disabled Sanity CDN, coarse type tags,
   raw webhook signatures, and the three-second consistency wait.
5. Use stable `revalidateTag` and `revalidatePath` APIs.
6. Pin dependencies and remove PPR, `use cache`, private cache directives,
   `cacheLife`, `cacheTag`, `updateTag`, and experimental configuration.
7. Retain the cookie-dependent root layout and existing UI. Accept dynamic
   storefront route classifications rather than redesigning the cart.

Gate: tests, formatting, TypeScript, and production build pass with no private
cart cache and no residual experimental cache APIs.

## 4. Document the real stable implementation

Maintain `docs/learning/next15-stable-caching.md` as interview material grounded
in the storefront:

- Separate request memoization, Data Cache, Full Route Cache, Router Cache, and
  browser/CDN caching.
- Explain why dynamic rendering can reuse cached non-personal data.
- Explain PPR versus Suspense without claiming stable storefront ISR.
- Describe Shopify catalog/cart boundaries and Sanity query/webhook boundaries.
- State which behavior is unit-tested, build-verified, externally verified, or
  still unverified.
- Do not include a synthetic cache lab or measured claims from one.

## 5. Local acceptance

Run from a clean working tree after implementation:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm audit --audit-level high
```

Also scan the diff for secrets, residual experimental directives, weakened tests,
and unexpected dependency changes. Obtain a focused independent re-review of
all fixes and updated merge claims.

## 6. Vercel Preview acceptance

After owner approval to push:

- Deploy only this branch; do not merge automatically.
- Confirm Preview has the real Shopify configuration and Preview-scoped Sanity
  configuration.
- Test homepage products, collection pages, product details, search, sort, cart
  creation, quantity changes, deletion, and checkout navigation.
- Use two browser sessions to check cart isolation.
- Create a temporary branch-specific Sanity webhook with a secret different
  from Production. Do not alter the Production webhook.
- Verify page/post create, update, unpublish/delete, slug changes, indexes,
  metadata, and sitemap behavior.
- Compare soft navigation/back navigation with hard reload after invalidation.
- Disable the temporary Preview webhook after acceptance.

## Completion and rollback

This branch becomes merge-eligible only when local review and Preview acceptance
pass and dependency changes introduce no unacceptable new risk. Merging remains
a separate owner decision.

Rollback before merge is returning to unchanged `main`. After any future merge,
rollback is redeploying the prior production commit while preserving existing
Production webhook configuration.
