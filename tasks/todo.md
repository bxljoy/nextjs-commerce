# Sanity webhook revalidation

- [x] Write and approve the feature contract in `docs/specs/sanity-webhook.md`.
- [x] Create `feature/sanity-webhook` from clean `main`.
- [x] Add Node tests for webhook authentication, validation, and tag selection.
- [x] Confirm the tests fail for the missing handler.
- [x] Implement the testable webhook policy.
- [x] Add explicit page/post cache tags.
- [x] Add `POST /api/revalidate/sanity` with signature verification.
- [x] Remove `<SanityLive />` and its live-query module.
- [x] Add the webhook secret to `.env.example`.
- [x] Update README setup/architecture/preview instructions.
- [x] Supersede the live-revalidation decision in `docs/intent/sanity-cms.md`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm exec tsc --noEmit`.
- [ ] Run `pnpm build`.
- [ ] Smoke-test rejection of an invalid signature.
- [ ] Review the final diff for scope and secrets.
