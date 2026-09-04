# Intent: Sanity.io as CMS

**Status:** Confirmed, not yet implemented
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
- Live preview (`defineLive` / `<SanityLive />`)
- Visual editing / stega / Presentation tool
- Product references — no joining Sanity documents to Shopify products
- Embedded Studio at `/studio` in this repo
- Sanity webhook revalidation (a likely follow-up, see Assumption 2)
- HMAC verification of the Shopify webhook — the query-string secret stays

The live-preview exclusion is the load-bearing one. Its cache-component pattern
requires splitting every CMS-backed page and layout into cached and dynamic
branches, which would tangle with this repo's existing `use cache` + PPR setup.
Row 1 first; revisit once content exists.

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
2. **Sanity content is cached like Shopify content** — `"use cache"` + `cacheTag` +
   `cacheLife`, mirroring `lib/shopify`. Consequence: a Sanity edit will not appear
   until the cache turns over, the same way Shopify collections behaved before
   webhooks were wired up. A Sanity webhook pointed at `/api/revalidate` is the
   natural follow-up.
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
