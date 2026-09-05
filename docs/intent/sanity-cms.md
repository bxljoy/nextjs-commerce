# Intent: Sanity.io as CMS

**Status:** Implemented and deployed. Revised 2026-09-05 — see Revisions.
**Date:** 2026-09-03
**Supersedes:** Shopify-backed pages (`getPage` / `getPages`)

## Intent

- **Outcome:** Sanity holds blog posts and landing pages; this repo queries it with
  GROQ and renders Portable Text.
- **User:** The repo owner, authoring content in a Sanity Studio that lives outside
  this codebase.
- **Why now:** Shopify's page editor stores an opaque HTML blob, rendered today as
  `<Prose html={page.body} />`. Structured, editable content is wanted instead.
- **Success:** `/[page]` serves Sanity content instead of Shopify, blog posts render,
  and this repo gains no Studio dependencies.
- **Constraint:** Keep the repo clean. Studio deploys separately to `*.sanity.studio`.
  Published content only.

## Out of scope

Deliberately excluded. Each was considered and declined, not overlooked.

- Draft mode (`draftMode()` + read token)
- Visual editing / stega / Presentation tool
- Product references — no joining Sanity documents to Shopify products
- Embedded Studio at `/studio` in this repo
- HMAC verification of the Shopify webhook — the query-string secret stays

Draft mode is the load-bearing exclusion. It forces every CMS-backed page and
layout to split into cached and dynamic branches, because published content
should be cached and shared while a draft preview must be per-request and
personal. That split is driven by drafts specifically — not by caching, and not
by live revalidation of published content.

## Scope

|             |                                                                                   |
| ----------- | --------------------------------------------------------------------------------- |
| New         | `lib/sanity/` (client + GROQ queries), Portable Text renderer component           |
| Rewired     | `app/[page]/page.tsx`, `app/[page]/opengraph-image.tsx`, `app/sitemap.ts`         |
| Removed     | `getPage` / `getPages` from `lib/shopify/index.ts`, `lib/shopify/queries/page.ts` |
| New routes  | `/blog` index, `/blog/[slug]`                                                     |
| Sanity side | Project + dataset, two schemas (`post`, `page`), `sanity deploy`                  |

### Routing takeover

`app/[page]/page.tsx` is a root-level catch-all currently backed by Shopify's
`getPage`. Sanity takes it over entirely — no fallback chain between the two
systems, because coexistence would mean every new page needs a "which CMS owns
this?" decision and every miss would cost a second lookup.

### Existing Shopify pages

Two exist at the time of writing:

- `/contact` — real content, gets recreated in Sanity
- `/data-sharing-opt-out` ("Your Privacy Choices") — Shopify-generated privacy
  boilerplate. Dropped. Hand-maintaining compliance copy on a demo store is worse
  than a 404.

## Assumptions

1. **`/contact` migrates, `/data-sharing-opt-out` does not.** See above.
2. ~~**Sanity content is cached like Shopify content**, with a webhook as the
   natural follow-up.~~ **Superseded 2026-09-05.** The caching shape still holds,
   but revalidation goes through `<SanityLive />` rather than a webhook. See
   Revisions.
3. **`lib/sanity` will not mirror `lib/shopify`'s shape.** No hand-rolled `fetch`.
   Sanity's official client handles the endpoint, CDN, and perspective, so the file
   will be substantially smaller. Same architectural role, different internals.

## Notes

- Sanity's native query language is **GROQ**, not GraphQL. A GraphQL API exists but
  is opt-in and must be deployed. GROQ is the default path.
- Rich text arrives as **Portable Text** (structured JSON), not HTML. The renderer
  component is the main piece of work in this migration — `<Prose html={...} />`
  cannot consume it.
- Verify `next-sanity` and `@portabletext/react` APIs against live docs before
  implementing; this area moves quickly.

## Revisions

### 2026-09-05 — live revalidation via `SanityLive`, not a webhook

**What changed:** `defineLive` / `<SanityLive />` moves from out-of-scope to
in-scope. The Sanity webhook named in Assumption 2 is dropped.

**Why:** the requirement sharpened from "content should eventually refresh" to
"content should refresh immediately." A webhook gives fresh-on-next-reload; only
the Live Content API updates an already-open page. The webhook was also rejected
on its own terms — it means maintaining a second revalidation endpoint and
configuring it in Sanity's admin.

**The original reasoning was wrong.** This document excluded live preview because
its "cache-component pattern requires splitting every CMS-backed page and layout
into cached and dynamic branches." That conflated two separate things. The split
comes from **draft mode**, which needs per-request rendering. Live revalidation of
**published** content needs no such split — `sanityFetch` attaches Sanity's
per-document `syncTags` via `cacheTag`, and `<SanityLive />` expires them through
a Server Action. Draft mode stays out of scope; that part of the exclusion holds.

**What it costs, honestly:**

- CORS origins must be allowlisted per environment, including Vercel preview URLs.
  `<SanityLive />` connects from the visitor's browser, unlike every other Sanity
  call in this repo, which is server-side.
- Concurrent listener quota scales with _traffic_, not with edits. Connections
  drop at ~4 hours.
- `lib/sanity/index.ts` accessors get rewritten onto `sanityFetch`.
- `useCdn: false` in `lib/sanity/client.ts` should flip to `true`. Its comment
  explains the choice in terms of the coarse-tag scheme, which no longer applies
  once per-document `syncTags` drive invalidation.

**Still out of scope:** draft mode, visual editing / stega, product references,
embedded Studio.

### 2026-09-05 — navigation is hardcoded, not CMS content

**What changed:** header and footer menus move from Shopify into
`lib/menus.ts`. `getMenu` and its query are deleted. Navigation does not go
into Sanity either.

**Why:** the header menu never existed in Shopify, so the navbar rendered
empty, and both footer links pointed at `/policies/privacy-policy` and
`/blogs/news` — routes this app has never served. Both 404'd.

The instinct was to move menus to Sanity, matching pages and posts. That is
the wrong boundary. Nav maps to routes, and routes are code: adding /blog
meant writing a route file _and_ adding a link, in one change. Splitting them
across two systems is precisely what let a menu name a path that does not
exist. A hardcoded array cannot drift from the routes it names, and cannot
render silently empty the way a missing CMS document does.

The CMS-nav option was briefly argued for on the grounds that a modelled
content type looks better in a portfolio. That is optimising for appearing
sophisticated rather than being correct, and it was dropped.

**Header and footer share one array on purpose.** The navbar is not sticky and
/search renders 100 products, so repeating the links in the footer is about
reachability. Split them when there is footer-only content to carry.

**The footer's real problem is unsolved.** A footer's job is what does not earn
header space — About, Privacy, Terms, Shipping, Returns. None of those exist,
which is why it looked empty. That is content work, not code work, and no
restyling will fix it.

**Knock-on:** `Navbar` and `Footer` become synchronous, since menus were the
only thing they awaited. Two `<Suspense>` boundaries that can no longer fire
were removed with them — one inside `footer.tsx`, one around `<Footer />` in
`app/page.tsx`. The boundaries around `ThreeItemGrid` and `Carousel` stay;
those still fetch.
