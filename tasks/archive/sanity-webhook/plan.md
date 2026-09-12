# Implementation Plan: Sanity webhook revalidation

## Overview

Replace Sanity Live Content listeners with a signed, tag-based webhook. Keep editorial reads cached and published-only, guarantee a fresh blocking read after invalidation, and test the feature on a Vercel branch preview before merging.

Specification: `docs/specs/sanity-webhook.md`

## Architecture decisions

- Use a dedicated `POST /api/revalidate/sanity` route so Shopify's existing endpoint and behavior remain unchanged.
- Use `next-sanity/webhook.parseBody` rather than custom cryptography.
- Use coarse `pages` and `posts` tags. This reliably handles creates, edits, slug changes, unpublishes, deletes, listings, metadata, and sitemap reads without reconstructing old paths.
- Use `revalidateTag(tag, { expire: 0 })` so the next visitor blocks for fresh content rather than receiving stale-while-revalidate data.
- Disable Sanity CDN reads to avoid a freshly invalidated Next cache being repopulated from a briefly stale CDN response.
- Use dependency injection only at the webhook boundary so signature/error/invalidation behavior can be tested with Node's built-in runner and no new dependency.

## Task list

### Phase 1: Contract and tests

- [x] Task 1: Create feature branch and record the approved spec and plan.
- [x] Task 2: Add failing webhook-policy tests and wire the built-in test runner.

### Checkpoint: Red

- [x] Focused tests fail because the webhook handler does not exist.

### Phase 2: Implementation

- [x] Task 3: Implement the webhook policy until focused tests pass.
- [x] Task 4: Add explicit Sanity cache tags and the signed route; remove SanityLive.

### Checkpoint: Green

- [x] Focused webhook tests pass.
- [x] TypeScript accepts the route and cache wiring.

### Phase 3: Documentation and preview readiness

- [x] Task 5: Update `.env.example`, README, and `docs/intent/sanity-cms.md`.
- [x] Task 6: Run all verification gates and inspect the final diff.

### Checkpoint: Complete

- [x] Formatting, unit tests, type checking, and production build pass.
- [x] Invalid-signature smoke test returns 401 without invalidation.
- [x] Worktree contains only intended feature changes and no secret.
- [x] Branch is ready to push for a Vercel Preview deployment.

## Risks and mitigations

| Risk                                           | Impact | Mitigation                                                         |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------ |
| Forged webhook invalidates caches              | Medium | Verify Sanity signature and fail closed when secret is absent      |
| Next request still sees stale Sanity CDN data  | High   | Wait for Content Lake consistency and set `useCdn: false`          |
| Slug changes/deletes leave stale paths         | Medium | Invalidate coarse type tags instead of only the projected new path |
| Preview webhook reaches a protected deployment | Medium | Document branch URL and Deployment Protection requirement          |
| At-least-once duplicate delivery               | Low    | Cache-tag invalidation is idempotent                               |
| Change accidentally affects Shopify            | High   | Separate route and leave Shopify files untouched                   |
| Pre-existing dependency advisories             | High   | Remediate in a separate dependency-focused branch and PR           |

## Rollout

1. Push `feature/sanity-webhook`.
2. Configure `SANITY_REVALIDATE_SECRET` for Vercel Preview.
3. Create a disabled-by-default or temporary Sanity webhook targeting the stable branch preview URL.
4. Enable it and verify create, update, unpublish/delete, invalid signature, blog index, detail page, landing page, and sitemap behavior.
5. Disable/remove the preview webhook after validation.
6. Configure the production secret and production webhook immediately before or after merge.
7. Merge only after preview acceptance; production continues using the old live path until merge.
