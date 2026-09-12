# Stable Next.js 15 storefront caching

## Preparation

- [x] Create the isolated stable Next.js 15 branch without changing `main`.
- [x] Archive the completed Sanity webhook plan/checklist.
- [x] Select and pin a patched stable Next.js 15 release.
- [x] Confirm the branch may become a merge candidate after Preview acceptance.
- [x] Remove the synthetic cache-lab requirement from the approved scope.

## Implementation

- [x] Replace incompatible `next-sanity` webhook parsing with
      `@sanity/webhook` while preserving signatures and consistency wait.
- [x] Configure explicit Shopify catalog caching and uncached cart transport.
- [x] Migrate Sanity reads to tagged, argument-keyed stable cache wrappers.
- [x] Include closed-over query text and Sanity client configuration in cache
      identity.
- [x] Adapt webhook and cart-action invalidation to stable APIs.
- [x] Remove PPR, Cache Components directives, and experimental configuration.
- [x] Remove the isolated cache lab and its scripts/documentation.
- [x] Refocus interview notes on the real Shopify and Sanity implementation.

## Local acceptance

- [x] Pass all 15 unit tests and formatting.
- [x] Pass TypeScript validation.
- [x] Pass a clean production build and inspect route classifications.
- [x] Re-run audit: stable branch has 11 findings (7 high, 4 moderate) versus
      `main` with 23 (12 high, 11 moderate); no new advisory was introduced.
- [x] Scan for secrets, residual experimental APIs, and unexpected dependency
      changes.
- [x] Complete a focused independent re-review with no Critical or Required
      findings.

## Vercel Preview acceptance

- [ ] Obtain approval before pushing the branch.
- [ ] Confirm Preview-only environment values and branch URL.
- [ ] Verify real Shopify catalog, product, collection, search, and sort flows.
- [ ] Verify cart creation, quantity changes, deletion, checkout navigation, and
      isolation across two browser sessions.
- [ ] Create a temporary signed Sanity webhook with a Preview-only secret.
- [ ] Verify Sanity create, update, unpublish/delete, slug changes, indexes,
      metadata, and sitemap refresh.
- [ ] Compare Router Cache soft/back navigation with a hard reload.
- [ ] Disable the temporary Preview webhook after validation.

## Merge decision

- [ ] Confirm the branch introduces no unacceptable dependency advisory.
- [ ] Record Preview evidence and remaining limitations.
- [ ] Obtain explicit owner approval before merging or changing Production.

`main`, the current Production deployment, and the Production webhook remain
unchanged until the final merge decision.
