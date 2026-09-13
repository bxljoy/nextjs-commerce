# Sanity and local Elasticsearch learning notes

## Verified Studio schema compatibility

Before preparing the search-lab fixtures, the owner provided the Studio schema
sources at `schemaTypes/post.ts`, `schemaTypes/seo.ts`, and
`schemaTypes/index.ts` in the local `commerce-studio` checkout. They were
inspected read-only on 2026-09-13.

The registered `post` type requires a string `title`, a `slug` with a
96-character maximum, and a `publishedAt` datetime. Its optional `excerpt` is
text with a 300-character maximum. `body` accepts Portable Text blocks and
images. The optional shared `seo` object has optional title and description
fields with warnings at 60 and 160 characters respectively.

This is compatible with the frontend fields in `lib/sanity/types.ts`. That file
models the projected slug as a string for reads, while fixture writes correctly
use the Studio slug object `{ _type: "slug", current: string }`. The search-lab
fixtures provide every required field, text-only Portable Text blocks with
stable keys, excerpts within 300 characters, slugs within 96 characters, and
SEO text within the warning lengths. No spec change was required.

The dedicated `SANITY_SEARCH_LAB_WRITE_TOKEN` was confirmed present exactly once
and nonempty in the ignored worktree `.env`, whose mode is `600`. Its value was
not printed. The Task 7 verification used only the dry-run seed path; no Sanity
write or delete was performed.
