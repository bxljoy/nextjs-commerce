# Intent: Authenticate Shopify webhooks with HMAC

**Status:** Deployed and Production-verified on `main`; stable local, protected Preview, stable-parent merge and post-merge verification complete.
**Date:** 2026-09-12
**Supersedes:** Query-string authentication for `POST /api/revalidate`

## Context

The Shopify cache-revalidation endpoint previously trusted an application secret
in each webhook URL. URL credentials can be exposed through configuration,
history and logs, and the query secret did not prove that the request body was
unchanged. The existing manual Shopify Admin subscriptions already include a
standard `X-Shopify-Hmac-Sha256` signature, so retaining a separate URL secret
would preserve risk without adding body integrity.

## Decision

Authenticate the exact raw request-body bytes with Shopify HMAC-SHA256 before
reading the topic or invalidating a cache tag. The key is the store-level signing
value shown on Shopify Admin's Webhooks page for manually configured webhooks. It
is supplied only through `SHOPIFY_WEBHOOK_SECRET`; a Storefront access token or
app client secret is not interchangeable with it.

Both maintained branches share the framework-independent verifier and topic
policy. Their route adapters remain branch-specific: `main` uses its two-argument
`revalidateTag(tag, "seconds")` API, while the stable caching branch uses its
one-argument `revalidateTag(tag)` API.

## Alternatives rejected

- **Retain the query secret:** credentials would remain in URLs and logs, and the
  body would still have no integrity protection.
- **Keep permanent dual authentication:** requiring both secrets would complicate
  operations without improving the authenticated body contract; accepting either
  would preserve the weaker legacy path.
- **Add the Shopify SDK:** Node's built-in cryptography provides the small verifier
  needed here, so another runtime dependency is unnecessary.
- **Add a replay database:** supported deliveries only perform idempotent cache-tag
  invalidation, and the application has no shared persistence requirement for
  webhook IDs.

## Consequences

- Missing or invalid signatures return HTTP 401, and missing server configuration
  returns HTTP 500. These real non-2xx responses make delivery failures visible
  and allow Shopify to retry. Valid supported topics return HTTP 200.
- Preview and Production use the same store-level signing secret because the same
  Shopify store signs both, although Vercel environment scopes remain separate.
- Shopify HMAC does not bypass Vercel Deployment Protection. A protected Preview
  subscription may temporarily use Vercel's short-lived automation-bypass query
  parameter; it remains separate from application authentication and must be
  revoked after testing.
- Product and collection topic policy is shared, but each maintained branch keeps
  its compatible cache-invalidation adapter.

## Migration

### Main/canary track

1. Configure `SHOPIFY_WEBHOOK_SECRET` in Preview and Production without exposing
   its value.
2. Implement and locally verify HMAC-only authentication on the main feature
   branch, then deploy that branch to Preview.
3. With explicit approval, create temporary manual product-update and
   collection-update Preview subscriptions using the protected branch alias and
   a short-lived Vercel automation bypass.
4. Verify genuine HTTP 200 deliveries, visible product and collection refreshes,
   invalid-signature rejection, and secret-safe logs.
5. Delete the temporary subscriptions and revoke the bypass before review and
   merge.
6. After approved Production deployment, verify one real product event and one
   collection event. Existing Production subscriptions need no application query
   secret because Shopify already sends HMAC headers.
7. Remove the legacy Vercel environment value after the approved rollback window.

### Stable track

The shared verifier and tests were ported byte-for-byte through a feature branch
based on `learning/next15-stable-caching`, with only the stable one-argument
invalidation adapter. After local and protected Preview acceptance, the owner
approved a fast-forward merge only into the stable branch. Its cache API was not
merged into `main`.

## Preview verification

The main feature branch at `ff7dbefa8f6382037a52144ac4adcce1497cd645` passed
local tests, formatting, TypeScript and a production build before deployment. A
protected Vercel Preview of that exact commit was then verified with temporary
manual Product update and Collection update subscriptions.

Agent-observed evidence:

- A direct signed request returned HTTP 200 with `revalidated: true`; an invalid
  HMAC returned HTTP 401 without invalidation.
- Previously warmed Product and Collection pages each reflected a reversible title
  change on the first request after the genuine Shopify event.
- Both pages returned to their original titles on the first request after the
  reverse events.
- Every dedicated Vercel bypass was revoked, edge rejection was verified, and
  local temporary credential artifacts and clipboard contents were removed.

Owner-attested evidence from Shopify Admin and the live Vercel Runtime Logs view:

- Genuine Product and Collection forward deliveries each produced
  `POST /api/revalidate` with HTTP 200.
- Genuine Product and Collection reverse deliveries each produced
  `POST /api/revalidate` with HTTP 200.
- The request entries exposed no raw body, HMAC value, signing secret or bypass
  value.
- Both temporary Shopify subscriptions were deleted; the six Production
  subscriptions were left unchanged.

No signing secret, HMAC, payload or bypass value was recorded.

### Stable Preview verification

Vercel deployed stable feature commit
`579593187a3606352d038446672175aa8ca9ccae` to a protected Preview before
acceptance began.

Agent-observed evidence:

- An invalid HMAC reached the stable application and returned HTTP 401 without
  invalidation.
- Previously warmed Product and Collection pages reflected reversible title
  changes on the first request after each genuine Shopify event.
- A later genuine Product event refreshed the product's newly available inventory
  state on the first request.
- Every temporary Vercel bypass was revoked, edge rejection was verified, and
  local credential records and clipboard contents were removed.

Owner-attested evidence from Shopify Admin, two isolated browser sessions, and
live Vercel Runtime Logs:

- Product and Collection forward and reverse events produced four genuine stable
  Preview `POST /api/revalidate` deliveries, all with HTTP 200.
- The entries exposed no raw body, HMAC value, signing secret or bypass value.
- Cart creation succeeded, and quantities remained isolated across two browser
  sessions.
- All temporary Shopify subscriptions were deleted; the six Production
  subscriptions were left unchanged.

The owner then approved a fast-forward merge of reviewed feature HEAD
`5dde1af1902eb289dcf4388022c71c9de048babc` only into
`learning/next15-stable-caching`. The stable branch alias advanced to that commit.
Two non-destructive genuine Product update deliveries returned HTTP 200 against
the merged alias; the deliberate invalid-signature probe returned HTTP 401 with
a generic error. The owner confirmed that no sensitive value appeared. The final
temporary subscription and bypass were removed, edge rejection was verified,
and `main` remained unchanged.

No signing secret, HMAC, payload or bypass value was recorded.

## Production verification

Vercel deployed `main` commit `56ed0fadf33a8379915693762e0060f56b1b5c07`
to the Production alias before acceptance began.

Agent-observed evidence:

- An invalid HMAC returned HTTP 401 without invalidation.
- Previously warmed Production Product and Collection pages reflected the genuine
  forward events on their first subsequent request.
- Both pages returned to their original titles on the first request after the
  genuine reverse events.

Owner-attested evidence from live Vercel Runtime Logs:

- Product and Collection forward and reverse events produced four genuine
  `POST /api/revalidate` deliveries, all with HTTP 200.
- The entries exposed no raw body, HMAC value, signing secret or query secret.

After acceptance, the obsolete combined Preview/Production
`SHOPIFY_REVALIDATION_SECRET` record was removed from Vercel. Separate encrypted
`SHOPIFY_WEBHOOK_SECRET` records remain configured for both environments. The six
Production manual subscriptions remain pointed at `/api/revalidate` without an
application query secret.

## Rollback

Before Production merge, delete the feature Preview and leave `main` unchanged.
After Production merge, prefer correcting environment configuration and
redeploying the last verified HMAC commit. If HMAC cannot be restored promptly,
an emergency legacy rollback requires restoring the prior deployment together
with matching temporary query-secret webhook URLs and environment configuration,
then rotating that temporary secret again after recovery. Rolling back code alone
cannot restore invalidation because the legacy URL parameters have already been
removed.
