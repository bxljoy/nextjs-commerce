# Stable Next.js 15 caching comparison

## Preparation

- [x] Confirm the interview-learning scope with the owner.
- [x] Create the isolated learning branch without changing main.
- [x] Archive the completed Sanity webhook plan/checklist.
- [x] Write the comparison spec and implementation plan.
- [x] Review spec, plan and isolated ISR fixture approach with owner.

## Implementation

- [x] Capture baseline build, tests and rendering classifications.
- [x] Verify and record exact patched stable Next.js 15 version and peer compatibility.
- [x] Obtain approval to replace incompatible next-sanity with official @sanity/webhook.
- [x] Record dependency/security risks and required approvals.
- [x] Add and observe failing cache-policy regression tests.
- [x] Configure explicit Shopify catalog caching and uncached cart transport.
- [x] Migrate Sanity reads to tagged, argument-keyed stable cache wrappers.
- [x] Adapt webhook and cart-action invalidation to selected version.
- [x] Pin stable Next.js and remove experimental feature dependencies.
- [x] Pass tests, formatting, TypeScript and production build.

## Learning evidence

- [x] Demonstrate data cache reuse and query-argument isolation.
- [x] Demonstrate TTL expiry and stale-while-revalidate behavior.
- [ ] Demonstrate real external signed webhook refresh including creation, deletion and slug change (Preview check).
- [x] Prove cart isolation with two cookie jars.
- [ ] Compare browser Router Cache versus server cache refresh (manual; browser MCP unavailable).
- [x] Demonstrate genuine route ISR using an approved cookie-free fixture.
- [x] Record failure/recovery behavior and reproduce commands.
- [x] Write the interview comparison guide.
- [ ] Review final diff, tests and known audit limitations.
- [ ] Obtain approval before push; verify Vercel Preview separately if requested.

Main and Production must remain unchanged. No automatic merge is planned.
