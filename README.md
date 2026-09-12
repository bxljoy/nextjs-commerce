# Commerce

A server-rendered storefront on the Next.js App Router, backed by two services:
**Shopify** for products, collections and the cart, **Sanity** for editorial
content.

- Live: https://nextjs-commerce-sigma-hazel-95.vercel.app
- Content editing: https://commerce-cms.sanity.studio
- Schemas: https://github.com/bxljoy/-commerce-studio

Built on [vercel/commerce](https://github.com/vercel/commerce), diverged to add
a CMS and retire Shopify's page support.

## Architecture

Two data layers, deliberately kept apart. Every route reads from exactly one.

| Route                             | Source  |                                                                |
| --------------------------------- | ------- | -------------------------------------------------------------- |
| `/`                               | Shopify | featured grid + carousel, from `hidden-homepage-*` collections |
| `/product/[handle]`               | Shopify |                                                                |
| `/search`, `/search/[collection]` | Shopify |                                                                |
| `/[page]`                         | Sanity  | root catch-all, e.g. `/contact`                                |
| `/blog`, `/blog/[slug]`           | Sanity  |                                                                |

```
lib/shopify/    hand-rolled GraphQL client — the Storefront API is plain
                GraphQL over HTTP, so there is no SDK to lean on
lib/sanity/     GROQ via @sanity/client, with explicit cache tags
```

Both cache with Next's `"use cache"` directive rather than the fetch Data
Cache, because neither client routes through `fetch` in a way Next can see.

**Invalidation differs by service:**

- **Shopify** — webhooks POST to `/api/revalidate`, which verifies Shopify's
  HMAC over the exact request body and calls `revalidateTag` for `products` or
  `collections`.
- **Sanity** — signed webhooks POST to `/api/revalidate/sanity`. Page and post
  queries carry separate coarse tags; a create, update, unpublish or delete
  expires the matching tag so the next visit blocks for fresh published
  content. Already-open pages do not update automatically.

Rich text arrives as Portable Text (structured JSON), rendered by
`components/portable-text.tsx`.

## Setup

Copy `.env.example` to `.env` and fill it in.

| Variable                          | Required |                                                       |
| --------------------------------- | -------- | ----------------------------------------------------- |
| `SHOPIFY_STORE_DOMAIN`            | yes      | `your-store.myshopify.com` — no protocol, no brackets |
| `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | yes      | **public** Storefront token (see below)               |
| `SHOPIFY_API_VERSION`             | no       | defaults to the value pinned in `lib/constants.ts`    |
| `SHOPIFY_WEBHOOK_SECRET`          | yes      | store-level signing value for manual Admin webhooks   |
| `SANITY_PROJECT_ID`               | yes      | from sanity.io/manage                                 |
| `SANITY_DATASET`                  | yes      | `production`                                          |
| `SANITY_REVALIDATE_SECRET`        | updates  | 32+ random characters; shared with the Sanity webhook |
| `SITE_NAME`, `COMPANY_NAME`       | no       | page titles and footer copyright                      |

All are server-only — no `NEXT_PUBLIC_` prefix, because every query runs in a
server component.

**The Storefront token trap.** `lib/shopify` sends the token as
`X-Shopify-Storefront-Access-Token`, which is the **public** token header. The
Headless channel also hands you a _private_ token; that one authenticates via
`Shopify-Storefront-Private-Token` and will fail here. Take the public one.

**Shopify content this expects.** The homepage reads two collections by
hardcoded handle — `hidden-homepage-featured-items` (needs 3+ products) and
`hidden-homepage-carousel`. Without them those sections render empty rather
than erroring. Navigation is defined in `lib/menus.ts`, not Shopify.

### Shopify webhook configuration

`SHOPIFY_WEBHOOK_SECRET` is required for Shopify cache revalidation. For webhooks
created manually in Shopify Admin, use the store-level signing value shown on
Shopify's Webhooks page. Neither the Storefront access token nor an app client
secret is a substitute for that value.

The Production webhook URL is
`https://nextjs-commerce-sigma-hazel-95.vercel.app/api/revalidate`, with no
application secret in its query. A subscription targeting a protected Preview
may temporarily use Vercel's automation-bypass query parameter. That bypass is
infrastructure authentication and is separate from Shopify HMAC authentication;
remove the temporary subscription and revoke its bypass after testing.

The endpoint returns HTTP 200 for a valid supported product or collection topic,
HTTP 401 for a missing or invalid signature, and HTTP 500 when the server signing
secret is not configured.

## Local development

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # production build
pnpm test         # prettier --check
```

Two things worth knowing:

- **`/sitemap.xml` returns 500 in `pnpm dev`.** A Turbopack RSC bug in this
  Next canary, unrelated to app code — it reproduces with the CMS layer removed
  entirely. Production is fine.
- **Cached data survives a page refresh, not a server restart.** Shopify and
  Sanity webhooks cannot reach `localhost` directly. Restart the dev server, or
  expose `/api/revalidate/sanity` through a tunnel and send a signed webhook.

## Vercel preview webhook test

1. Push a feature branch and use its stable branch preview URL, not an
   individual deployment URL.
2. Set `SANITY_REVALIDATE_SECRET` in Vercel's **Preview** environment. Use a
   different value from production.
3. In Sanity project settings, create a temporary webhook:
   - URL: `https://<branch-preview>/api/revalidate/sanity`
   - Method/events: `POST`; Create, Update, Delete
   - Filter: `_type in ["page", "post"]`
   - Projection: `{_type}`
   - Drafts/versions: disabled
   - Secret: the Preview environment value
4. If Deployment Protection is enabled, configure an exception or bypass that
   allows Sanity to reach only this endpoint.
5. Verify page/post creation, editing, unpublishing/deletion, indexes and
   `/sitemap.xml`, then disable the temporary webhook.

Production keeps its existing behavior until this branch is merged and a
production webhook and secret are configured.

## Notable behaviour

- Missing Sanity or Shopify config makes routes render empty rather than throw,
  via guards in each data layer. Convenient locally, but it means a
  misconfigured deploy fails silently.
- `/[page]` returns HTTP 200 for a missing page instead of 404. It is a Partial
  Prerender route, so the static shell flushes before `notFound()` runs.
- The Shopify webhook endpoint returns real 401 and 500 responses for
  authentication and configuration failures, so Shopify can surface and retry
  genuine failed deliveries. The Sanity endpoint also uses real 400/401/500
  statuses and Sanity's signed request verification.
- **The two pinned API versions need opposite habits.** `SHOPIFY_API_VERSION`
  expires: Shopify supports a version for about twelve months, then quietly
  serves a different one than the one named, so it needs bumping periodically.
  `SANITY_API_VERSION` does not expire — old versions keep working, and Sanity
  signals deprecation through response headers long before removing anything.
  Bump that one only when a query needs a newer GROQ feature.

## Decisions

- `docs/intent/shopify-webhooks.md` records the Shopify webhook authentication,
  rollout and rollback decisions.
- `docs/intent/sanity-cms.md` records why the CMS is scoped the way it is,
  including what was deliberately left out and one piece of reasoning that
  turned out to be wrong.

## License

MIT, inherited from [vercel/commerce](https://github.com/vercel/commerce). See
`license.md`.
