# Spec: Sanity webhook revalidation

## Objective

Replace visitor-side Sanity Live Content updates with a signed webhook because this storefront only needs published editorial content to be fresh on the next visit or reload.

The affected users are visitors reading Sanity-backed pages and blog posts. A create, update, unpublish, or delete in Sanity must invalidate the relevant Next.js cache entries without changing Shopify behavior or exposing drafts.

## Tech stack

- Next.js `15.6.0-canary.60` App Router with Cache Components
- React `19.0.0`
- `next-sanity` `13.3.4` (`parseBody` from `next-sanity/webhook`)
- `@sanity/client` `8.4.0`
- TypeScript `5.8.2`
- Node.js built-in test runner

## Commands

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm dev
```

## Project structure

```text
app/api/revalidate/sanity/route.ts  Signed Sanity webhook route
lib/sanity/index.ts                 Cached page and post accessors
lib/sanity/webhook.ts               Testable webhook policy and handler
docs/intent/sanity-cms.md           Architectural decision history
docs/specs/sanity-webhook.md        Feature contract
tasks/plan.md                       Implementation plan
tasks/todo.md                       Execution checklist
```

## Contract

### Cache behavior

- `getPage` and `getPages` share a page cache tag.
- `getPost` and `getPosts` share a post cache tag.
- A valid `page` webhook expires the page tag immediately.
- A valid `post` webhook expires the post tag immediately.
- The first request after invalidation blocks for fresh content instead of receiving a stale response.
- Sanity reads use the published perspective only.
- Sanity CDN reads are disabled so a successful invalidation is not followed by a stale CDN response.
- `/sitemap.xml` remains force-dynamic and receives fresh page/post lists through the invalidated accessors.

### HTTP behavior

Endpoint: `POST /api/revalidate/sanity`

| Condition                             | HTTP status | Effect                                       |
| ------------------------------------- | ----------: | -------------------------------------------- |
| Valid signature and supported `_type` |         200 | Relevant tag is invalidated                  |
| Missing or invalid signature          |         401 | No invalidation                              |
| Malformed or unsupported payload      |         400 | No invalidation                              |
| Server has no webhook secret          |         500 | No invalidation; deployment is misconfigured |

The handler waits for Sanity Content Lake eventual consistency before invalidating. Duplicate webhook deliveries are safe because tag invalidation is idempotent.

### Sanity webhook configuration

- Method: `POST`
- Events: Create, Update, Delete
- Filter: `_type in ["page", "post"]`
- Projection: `{_type}`
- Drafts/versions: disabled
- Secret: same value as `SANITY_REVALIDATE_SECRET` in the target Vercel environment

Preview and production use separate webhook records and environment-specific secrets. The preview webhook targets the stable branch preview URL and must be able to pass Vercel Deployment Protection.

## Code style

Follow the existing small-function, named-export style and keep route wiring thin:

```ts
export async function POST(request: NextRequest): Promise<Response> {
  return handleSanityWebhook(request, dependencies);
}
```

Use explicit status codes, generic public errors, and never log the request body or secret.

## Testing strategy

The Node.js built-in test runner covers the testable webhook handler without network calls. Tests must prove:

- Missing server secret fails closed.
- Invalid signatures cannot invalidate cache entries.
- Malformed and unsupported payloads are rejected.
- Valid page and post events invalidate only their matching tag.
- Successful responses identify the invalidated tag.

The production build remains the integration check for Next.js route wiring and cache APIs.

## Boundaries

### Always

- Validate the Sanity webhook signature using `next-sanity/webhook`.
- Keep the webhook secret in environment configuration.
- Return explicit HTTP status codes.
- Keep published-only Sanity reads.
- Run tests, type checking, formatting, and the production build.

### Ask first

- Add a new dependency or rate-limiting service.
- Change Shopify webhook behavior.
- Enable Sanity drafts, visual editing, or preview tokens.
- Change Vercel Deployment Protection.

### Never

- Commit a real webhook secret.
- Accept an unsigned webhook, including in development.
- Log webhook bodies or credentials.
- Expose drafts or change Shopify invalidation as part of this feature.

## Success criteria

1. `<SanityLive />` and `defineLive` are no longer used.
2. Valid signed page/post webhooks invalidate the correct cache entries.
3. Invalid requests never invalidate data.
4. Publishing, unpublishing, or deleting content is reflected on the next visit/reload.
5. Preview setup is documented without changing production configuration.
6. `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm build` pass.

## Official references

- Sanity `parseBody`: https://reference.sanity.io/next-sanity/webhook/parseBody/
- Sanity webhook validation for Next.js: https://www.sanity.io/docs/nextjs/validating-sanity-webhooks-nextjs
- Sanity webhook configuration and delivery behavior: https://www.sanity.io/docs/content-lake/webhooks
- Next.js `revalidateTag`: https://nextjs.org/docs/app/api-reference/functions/revalidateTag
- Next.js `cacheTag`: https://nextjs.org/docs/app/api-reference/functions/cacheTag

## Open questions

None. The freshness requirement, security boundary, branch workflow, and preview-first rollout were confirmed before implementation.
