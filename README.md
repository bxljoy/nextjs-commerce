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
lib/sanity/     GROQ via @sanity/client, plus defineLive for revalidation
```

Both cache with Next's `"use cache"` directive rather than the fetch Data
Cache, because neither client routes through `fetch` in a way Next can see.

**Invalidation differs by service:**

- **Shopify** — webhooks POST to `/api/revalidate`, which checks a shared
  secret and calls `revalidateTag` for `products` or `collections`.
- **Sanity** — `<SanityLive />` in the root layout holds a connection to the
  Live Content API. `sanityFetch` attaches Sanity's per-document `syncTags`,
  and changes expire them through a Server Action. Edits reach open pages in
  seconds with no webhook.

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
| `SITE_NAME`, `COMPANY_NAME`       | no       | page titles and footer copyright                      |

All are server-only — no `NEXT_PUBLIC_` prefix, because every query runs in a
server component.

**The Storefront token trap.** `lib/shopify` sends the token as
`X-Shopify-Storefront-Access-Token`, which is the **public** token header. The
Headless channel also hands you a _private_ token; that one authenticates via
`Shopify-Storefront-Private-Token` and will fail here. Take the public one.

**Shopify content this expects.** The homepage reads two collections by
hardcoded handle — `hidden-homepage-featured-items` (needs 3+ products) and
`hidden-homepage-carousel` — plus menus `next-js-frontend-header-menu` and
`next-js-frontend-footer-menu`. Without them those sections render empty rather
than erroring.

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
- **Cached data survives a page refresh, not a server restart.** After changing
  Shopify or Sanity content, restart the dev server rather than hard-reloading.

## Notable behaviour

- Missing Sanity or Shopify config makes routes render empty rather than throw,
  via guards in each data layer. Convenient locally, but it means a
  misconfigured deploy fails silently.
- `/[page]` returns HTTP 200 for a missing page instead of 404. It is a Partial
  Prerender route, so the static shell flushes before `notFound()` runs.
- The Shopify webhook endpoint always answers 200, including on a rejected
  secret, so Shopify does not retry forever. A bad secret is only visible in the
  server logs.

## Decisions

`docs/intent/sanity-cms.md` records why the CMS is scoped the way it is,
including what was deliberately left out and one piece of reasoning that turned
out to be wrong.

## License

MIT, inherited from [vercel/commerce](https://github.com/vercel/commerce). See
`license.md`.
