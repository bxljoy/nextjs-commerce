# Spec: Shopify webhook HMAC authentication

## Status

Proposed for owner review. No implementation code has been written.

The owner accepts the temporary Shopify cache-revalidation gap created by
removing the legacy query-string secret from the manually configured webhook
URLs before this implementation is deployed.

## Objective

Replace the custom `?secret=...` check on `POST /api/revalidate` with Shopify's
standard `X-Shopify-Hmac-Sha256` verification. Authenticate the exact raw request
body with the store-level signing secret shown under Shopify Admin → Settings →
Notifications → Webhooks, then invalidate only allowlisted product or collection
cache tags.

Apply one shared authentication contract to both maintained branches while
keeping their incompatible Next.js cache APIs isolated:

1. Implement and merge `feature/shopify-webhook-hmac-main` into `main`.
2. Apply the shared verifier to `feature/shopify-webhook-hmac-stable`, created
   from `learning/next15-stable-caching`, and merge it only into that branch.
3. Preserve both final branches; do not merge the stable implementation into
   `main`.

## Context and assumptions

- Shopify webhooks were created manually in Shopify Admin, not by an app or the
  Admin API.
- Shopify already adds `X-Shopify-Hmac-Sha256` to each HTTPS delivery.
- Manual webhooks use the store-level signing secret displayed on the Webhooks
  settings page. An app client secret or Storefront access token is not the
  correct key for these subscriptions.
- Production and Preview use the same Shopify store, so both environments must
  use the same store-level HMAC secret. Vercel environment scoping still remains
  separate.
- The exposed legacy query secret is considered compromised and will be retired;
  it must not appear in code, documentation examples, screenshots, or new URLs.
- No new runtime dependency is required. Node's built-in `node:crypto` provides
  HMAC-SHA256 and constant-time comparison.
- The endpoint path remains `POST /api/revalidate`.

## Technology and versions

| Branch                           | Next.js version         | Invalidation adapter                       |
| -------------------------------- | ----------------------- | ------------------------------------------ |
| `main`                           | `15.6.0-canary.60`      | `revalidateTag(tag, "seconds")`            |
| `learning/next15-stable-caching` | `15.5.25`               | `revalidateTag(tag)`                       |
| Shared verifier                  | Node.js built-in crypto | No import from `next/cache`                |
| Test runner                      | Node.js built-in test   | Real generated HMAC signatures, no network |

## Trust boundary and threat model

An unauthenticated public HTTP request crosses into a cache-control endpoint.
The protected assets are the integrity and availability of the storefront cache,
the Shopify signing secret, and reliable product/collection freshness.

| Threat              | Abuse case                                                       | Control                                                                 |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Spoofing            | An attacker pretends to be Shopify and expires caches repeatedly | Require a valid Shopify HMAC before reading topic or invalidating tags  |
| Tampering           | A payload is modified after Shopify signs it                     | Compute HMAC over the exact unparsed body                               |
| Secret disclosure   | Credentials appear in URLs, logs, responses, tests, or Git       | Environment-only secret; generic errors; never log body/header/secret   |
| Timing side channel | Signature comparisons leak matching-prefix information           | Equal-length check followed by `crypto.timingSafeEqual`                 |
| Replay/duplicates   | Shopify retries the same valid delivery                          | Tag invalidation is idempotent; no stateful deduplication is introduced |
| Unsupported topics  | A valid Shopify webhook triggers an unintended invalidation      | Exact allowlist of six product/collection topics                        |
| Misconfiguration    | A deployment starts without the signing secret                   | Fail closed with HTTP 500 and no invalidation                           |
| Denial of service   | Large or repeated unsigned requests consume endpoint work        | Vercel/Next request limits remain the outer bound; no new limiter       |

The endpoint does not mutate Shopify data, create orders, or expose cached
content. Persistent webhook-ID storage and application rate limiting are outside
this focused migration because repeated valid invalidation is safe and the
application currently has no shared rate-limit store.

## Authentication contract

### Signature input

1. Read `X-Shopify-Hmac-Sha256` from the request headers.
2. Read the body exactly once with `request.arrayBuffer()` before any decoding
   or JSON parsing, then expose it to the verifier as a `Uint8Array`.
3. Compute:

   ```text
   base64(HMAC-SHA256(SHOPIFY_WEBHOOK_SECRET, exactRawBodyBytes))
   ```

4. Convert the expected and received base64 strings to byte sequences.
5. Return invalid if either value is absent or their lengths differ.
6. Compare equal-length values with `crypto.timingSafeEqual`.
7. Only after successful verification may the handler inspect the topic or call
   an invalidation dependency.

The payload does not need to be parsed because cache selection depends only on
Shopify's topic header. Avoiding JSON parsing also prevents reserialization from
changing the bytes used for verification.

### Topic allowlist

| `X-Shopify-Topic` value | Cache tag     |
| ----------------------- | ------------- |
| `collections/create`    | `collections` |
| `collections/delete`    | `collections` |
| `collections/update`    | `collections` |
| `products/create`       | `products`    |
| `products/delete`       | `products`    |
| `products/update`       | `products`    |

A valid signature with any other topic returns success without invalidating a
cache tag. Authentication happens before this no-op response so the endpoint
never treats unsigned traffic as a successful webhook.

## Module and route interfaces

Create a shared, framework-independent module:

```text
lib/shopify/webhook.ts
lib/shopify/webhook.test.ts
```

Its public boundary is intentionally small:

```ts
export function isValidShopifyWebhook(
  rawBody: Uint8Array,
  signature: string,
  secret: string,
): boolean;

export type ShopifyWebhookDependencies = {
  request: Request;
  secret: string | undefined;
  revalidateTag: (tag: "products" | "collections") => void;
  reportError: (message: string) => void;
};

export async function handleShopifyWebhook(
  dependencies: ShopifyWebhookDependencies,
): Promise<Response>;
```

The shared module must not import `next/cache`, `next/headers`, or branch-specific
cache APIs. Each route injects its adapter:

```ts
// main
revalidateTag: (tag) => revalidateTag(tag, "seconds");

// stable branch
revalidateTag: (tag) => revalidateTag(tag);
```

Remove webhook authentication and topic-selection responsibilities from
`lib/shopify/index.ts`. Keep catalog/cart GraphQL transport and reshaping behavior
unchanged.

## HTTP response contract

| Condition                                 | HTTP status | Body                                                  | Invalidation  |
| ----------------------------------------- | ----------: | ----------------------------------------------------- | ------------- |
| Valid HMAC and supported product topic    |         200 | `{ status: 200, revalidated: true, now: number }`     | `products`    |
| Valid HMAC and supported collection topic |         200 | `{ status: 200, revalidated: true, now: number }`     | `collections` |
| Valid HMAC and unsupported topic          |         200 | `{ status: 200 }`                                     | None          |
| Missing or invalid HMAC                   |         401 | `{ error: "Invalid Shopify webhook signature" }`      | None          |
| Missing `SHOPIFY_WEBHOOK_SECRET`          |         500 | `{ error: "Webhook revalidation is not configured" }` | None          |
| Unexpected handler failure                |         500 | Generic error; no stack, body, signature, or secret   | None          |

Returning a real non-2xx response for an invalid or misconfigured webhook is an
intentional change from the legacy handler's HTTP-200 response containing a
`status: 401` field. Shopify may retry genuine failed deliveries, which makes a
bad signing-secret deployment visible instead of silently losing invalidations.

Logs may contain a generic reason and safe topic/webhook identifier, but never
the raw body, HMAC value, signing secret, Storefront token, legacy secret, or
Vercel bypass secret.

## Environment and external configuration

### Application environments

Replace the legacy variable in `.env.example` and target Vercel environments:

```text
SHOPIFY_WEBHOOK_SECRET=""
```

- Value: the store-level signing secret displayed by Shopify for manually
  configured webhooks.
- Production and Preview use the same value because the same store signs both.
- Do not use `SHOPIFY_STOREFRONT_ACCESS_TOKEN` or an app client secret.
- Remove `SHOPIFY_REVALIDATION_SECRET` from code and documentation after HMAC
  deployment. Remove the real Vercel variable after the rollback window.

### Vercel Preview protection

The Shopify HMAC proves the sender to the application but does not bypass Vercel
Deployment Protection. Shopify's manual webhook configuration does not provide a
custom-header field, so temporary Preview webhook URLs use only Vercel's
short-lived automation bypass query parameter:

```text
https://<branch-alias>/api/revalidate?x-vercel-protection-bypass=<temporary-value>
```

This parameter is infrastructure authentication, not application webhook
authentication. Revoke it and delete the temporary Preview subscriptions after
testing. Production URLs contain no query secret or bypass parameter.

## Migration sequence

### Main/canary track

1. Create `feature/shopify-webhook-hmac-main` from the current remote `main`.
2. Add `SHOPIFY_WEBHOOK_SECRET` to Preview and Production configuration without
   exposing its value.
3. Implement HMAC-only verification and the canary invalidation adapter using
   test-driven development.
4. Deploy the feature branch to Vercel Preview.
5. Create temporary manual `products/update` and `collections/update` Preview
   subscriptions targeting the protected branch alias with the temporary Vercel
   bypass parameter.
6. Verify genuine delivery responses and visible cache refresh, then remove the
   temporary subscriptions and revoke their bypass.
7. Merge only after review and Preview acceptance.
8. Existing Production subscriptions work after deployment because Shopify was
   already sending HMAC headers; their legacy query parameters have already been
   removed by owner decision.
9. Verify one real Production product event and one collection event.
10. Retire the exposed `SHOPIFY_REVALIDATION_SECRET` Vercel value after the
    rollback window.

### Stable track

1. After the main implementation is accepted, create
   `feature/shopify-webhook-hmac-stable` from
   `learning/next15-stable-caching`.
2. Cherry-pick only the shared verifier/test commit and conflict-free common
   documentation where appropriate.
3. Add the stable one-argument invalidation adapter without importing canary
   cache APIs.
4. Repeat local, Preview, security, and review gates.
5. Merge only into `learning/next15-stable-caching` and retain both maintained
   branches.

### Rollback

Before Production merge, rollback is deleting the feature Preview and leaving
`main` unchanged. After Production merge, rollback options are:

1. Preferred: redeploy the last verified HMAC commit after correcting environment
   configuration.
2. Emergency legacy rollback: restore the prior deployment **and** temporarily
   restore matching `?secret=...` webhook URLs and environment value, then rotate
   that secret again after recovery.

Because the owner already removed legacy URL parameters and accepts the current
gap, rolling back application code alone would not restore invalidation.

## Testing strategy

Use Node's built-in test runner and real signatures generated independently with
`node:crypto`. Tests are written and observed failing before implementation.

### Verifier tests

- Accept an authentic base64 HMAC over the exact raw body.
- Reject missing, empty, malformed, truncated, and wrong-length signatures.
- Reject a signature produced with another secret.
- Reject the original signature after any byte, whitespace, or payload change.
- Handle equal-length invalid signatures without throwing.
- Never expose secret, signature, or raw body in returned errors.

### Handler tests

- Missing server configuration returns HTTP 500 and never invalidates.
- Missing/invalid signatures return HTTP 401 and never invalidate.
- Every product topic maps only to `products`.
- Every collection topic maps only to `collections`.
- A valid unsupported topic returns HTTP 200 without invalidation.
- Duplicate valid deliveries are harmless and may repeat the same invalidation.
- Public response bodies and reportable errors follow the specified contract.

### Integration gates per branch

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm audit --audit-level high
```

Preview acceptance requires genuine Shopify `products/update` and
`collections/update` deliveries, a valid 200 response, visible fresh storefront
data after reload, invalid-signature rejection, and cleanup of temporary webhook
and bypass configuration. Production verification occurs only after explicit
owner approval and merge.

## Documentation requirements

Update in each target branch as applicable:

- `.env.example`: replace the legacy variable name.
- `README.md`: explain HMAC authentication, signing-secret source, Preview
  protection, and HTTP behavior.
- A Shopify intent/decision document: record why standard HMAC replaced the
  legacy query-string secret and why both branches share one verifier.
- Task plans/checklists: distinguish agent-observed tests from owner-attested
  Shopify/Vercel checks.

## Code style

Keep route wiring thin and inject branch-specific invalidation:

```ts
export async function POST(request: NextRequest): Promise<Response> {
  return handleShopifyWebhook({
    request,
    secret: process.env.SHOPIFY_WEBHOOK_SECRET,
    revalidateTag: (tag) => revalidateTag(tag, "seconds"),
    reportError: (message) => console.error(message),
  });
}
```

Use named exports, explicit dependency types, generic public errors, and no
commented legacy implementation.

## Commands

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm audit --audit-level high
```

Use `git diff --check`, a secret-pattern scan, exact dependency diff review, and
an independent read-only review before each merge.

## Boundaries

### Always

- Verify the exact raw body bytes before decoding, topic handling, or
  invalidation.
- Fail closed when the HMAC or signing secret is absent or invalid.
- Use constant-time equality for equal-length signatures.
- Keep signing material in environment configuration.
- Test and Preview each branch independently.
- Preserve branch-specific cache APIs and both maintained branches.

### Ask first

- Add a dependency, persistent replay store, or rate limiter.
- Change supported Shopify topics or cache tags.
- Change Vercel Deployment Protection.
- Create, edit, or delete Shopify webhook subscriptions.
- Merge either feature branch or touch Production configuration/content.

### Never

- Commit, print, log, or paste any real secret or signature.
- Use the Storefront token or an app secret for these manually created webhook
  subscriptions.
- Decode, parse, or reserialize the body before HMAC verification.
- Accept an unsigned development/test bypass.
- Keep the compromised query-string authentication path in final code.
- Merge canary cache APIs into the stable branch or stable cache APIs into
  `main`.

## Success criteria

1. Both branches use the same reviewed raw-body HMAC verifier and tests.
2. No final application code reads a webhook secret from the URL.
3. Missing/invalid signatures cannot invalidate any tag and return a real 401.
4. Missing server configuration fails closed with a real 500.
5. Exactly six allowlisted topics map to the existing two cache tags.
6. Genuine Product and Collection Preview events return 200 and refresh visible
   data on reload in each branch.
7. The canary and stable adapters use only their supported `revalidateTag`
   signatures.
8. Legacy secret references are removed from source/docs and the real Vercel
   value is retired after the rollback window.
9. Tests, formatting, TypeScript, production builds, audit review, secret scan,
   and independent reviews pass for both branches.
10. Temporary Preview webhooks and Vercel bypass secrets are removed after each
    acceptance run.
11. `main` and `learning/next15-stable-caching` remain separate maintained
    branches.

## Official references

- Shopify webhook verification:
  https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- Shopify HTTPS delivery headers:
  https://shopify.dev/docs/apps/build/webhooks/delivery-structure
- Shopify manual webhook configuration:
  https://help.shopify.com/en/manual/fulfillment/setup/notifications/webhooks
- Node `crypto.createHmac`:
  https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options
- Node `crypto.timingSafeEqual`:
  https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
- Vercel Protection Bypass for Automation:
  https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation

## Open questions

None. The webhook source, signing-secret type, accepted temporary outage, branch
strategy, endpoint path, topic scope, Preview protection, and no-new-dependency
constraint were confirmed before specification.
