# Intent: Authenticate Shopify webhooks with HMAC

**Status:** Implemented locally; external Preview and Production acceptance pending.
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

After the main implementation is accepted, port the shared verifier and tests to
a feature branch based on `learning/next15-stable-caching`, add only the stable
one-argument invalidation adapter, and repeat local and Preview gates. Merge that
work only into the stable branch; do not merge its cache API into `main`.

## Rollback

Before Production merge, delete the feature Preview and leave `main` unchanged.
After Production merge, prefer correcting environment configuration and
redeploying the last verified HMAC commit. If HMAC cannot be restored promptly,
an emergency legacy rollback requires restoring the prior deployment together
with matching temporary query-secret webhook URLs and environment configuration,
then rotating that temporary secret again after recovery. Rolling back code alone
cannot restore invalidation because the legacy URL parameters have already been
removed.
