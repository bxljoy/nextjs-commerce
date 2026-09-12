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
lib/sanity/     GROQ via @sanity/client, cached through unstable_cache
```

This learning branch uses stable Next.js 15 cache APIs explicitly:

- Shopify catalog GraphQL calls use the fetch Data Cache with
  `cache: "force-cache"`, a one-hour TTL and product/collection tags.
- Sanity query functions use `unstable_cache` with a one-hour TTL. Function
  arguments distinguish detail entries and coarse page/post tags drive webhooks.
- Cart reads and every mutation use `cache: "no-store"`; cart cookies are read
  outside shared cache boundaries.

**Invalidation differs by service:**

- **Shopify** — webhooks POST to `/api/revalidate`, which checks a shared
  secret and calls `revalidateTag` for `products` or `collections`.
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
| `SHOPIFY_REVALIDATION_SECRET`     | no       | any random string; only used by the webhook           |
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

## Local development

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # production build
pnpm test         # unit tests + formatting
pnpm lab:cache    # deterministic production-mode caching experiments
```

Cache conclusions should come from a production build, not development HMR.
Next.js can reuse server fetches across HMR even when they specify `no-store`.
Shopify and Sanity webhooks also cannot reach `localhost` directly; expose the
signed endpoint through a tunnel only when deliberately testing webhooks.

`experiments/next15-cache-lab/` demonstrates persistent Data Cache reuse,
time-based stale-while-revalidate, tag invalidation, two-cookie cart isolation,
and Full Route Cache/ISR failure recovery without changing the storefront.

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
- The root layout reads the cart cookie. Without PPR that makes storefront
  routes dynamically rendered, although their Shopify/Sanity data can still be
  reused from the Data Cache. The isolated cache lab demonstrates genuine ISR.
- The Shopify webhook endpoint always answers 200, including on a rejected
  secret, so Shopify does not retry forever. The Sanity endpoint instead uses
  real 400/401/500 statuses and verifies the untouched raw request body with
  the official `@sanity/webhook` toolkit.
- **The two pinned API versions need opposite habits.** `SHOPIFY_API_VERSION`
  expires: Shopify supports a version for about twelve months, then quietly
  serves a different one than the one named, so it needs bumping periodically.
  `SANITY_API_VERSION` does not expire — old versions keep working, and Sanity
  signals deprecation through response headers long before removing anything.
  Bump that one only when a query needs a newer GROQ feature.

## Decisions

`docs/intent/sanity-cms.md` records why the CMS is scoped the way it is,
including what was deliberately left out and one piece of reasoning that turned
out to be wrong. `docs/learning/next15-caching-comparison.md` records the stable
cache experiment, measured results and interview explanation.

## License

MIT, inherited from [vercel/commerce](https://github.com/vercel/commerce). See
`license.md`.
