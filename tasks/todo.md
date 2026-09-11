# Sanity webhook revalidation

- [x] Write and approve the feature contract in `docs/specs/sanity-webhook.md`.
- [x] Create `feature/sanity-webhook` from clean `main`.
- [ ] Add Node tests for webhook authentication, validation, and tag selection.
- [ ] Confirm the tests fail for the missing handler.
- [ ] Implement the testable webhook policy.
- [ ] Add explicit page/post cache tags.
- [ ] Add `POST /api/revalidate/sanity` with signature verification.
- [ ] Remove `<SanityLive />` and its live-query module.
- [ ] Add the webhook secret to `.env.example`.
- [ ] Update README setup/architecture/preview instructions.
- [ ] Supersede the live-revalidation decision in `docs/intent/sanity-cms.md`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm exec tsc --noEmit`.
- [ ] Run `pnpm build`.
- [ ] Smoke-test rejection of an invalid signature.
- [ ] Review the final diff for scope and secrets.
