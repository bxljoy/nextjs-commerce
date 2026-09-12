# Shopify Webhook HMAC — Stable Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the reviewed Shopify raw-body HMAC contract to `learning/next15-stable-caching` while preserving stable Next.js `15.5.25` cache behavior and keeping the branch separate from `main`.

**Architecture:** Reuse the exact framework-independent verifier and handler commits accepted on `main`; do not rewrite cryptography. Replace only the stable branch's route adapter with one-argument `revalidateTag(tag)`, remove its legacy query-secret handler, and independently repeat local and Vercel Preview acceptance.

**Tech Stack:** Next.js `15.5.25`, TypeScript `5.8.2`, Node `node:crypto`, Node built-in test runner, Vercel Preview, manually configured Shopify Admin webhooks.

**Spec:** `docs/specs/shopify-webhook-hmac.md`

## Global Constraints

- Begin only after the main HMAC implementation is merged and Production-verified.
- Create `feature/shopify-webhook-hmac-stable` from the current remote `learning/next15-stable-caching`.
- Reuse the exact accepted shared verifier/handler commits retained on `feature/shopify-webhook-hmac-main`; stop if commit identity is ambiguous.
- Use only stable `revalidateTag(tag)`. Never introduce `revalidateTag(tag, "seconds")`, PPR, `use cache`, `cacheLife`, `cacheTag`, or `updateTag` into this branch.
- Do not add dependencies or change Shopify catalog/cart cache policies.
- Verify exact raw body bytes before decoding, topic handling, or invalidation.
- Never expose signing material, HMAC values, payloads, Storefront tokens, legacy secrets, or Vercel bypass values.
- Stop for owner approval before creating Shopify subscriptions, changing Vercel protection, pushing, or merging.
- Merge only into `learning/next15-stable-caching`; do not merge this feature branch into `main`.

---

### Task 1: Create the stable feature branch and import the approved contract

**Files:**

- Add from canonical commit: `docs/specs/shopify-webhook-hmac.md`
- No runtime files modified yet

**Interfaces:**

- Establishes: stable implementation branch based on the verified learning branch
- Consumes: approved canonical spec commit `688a743`

- [ ] **Step 1: Verify source and target branch state**

From a clean repository, run:

```bash
git fetch origin --prune
test -z "$(git status --short)"
test "$(git rev-parse learning/next15-stable-caching)" = \
  "$(git rev-parse origin/learning/next15-stable-caching)"
test "$(git rev-parse main)" = "$(git rev-parse origin/main)"
git show-ref --verify --quiet refs/heads/feature/shopify-webhook-hmac-main
git log -1 --oneline learning/next15-stable-caching
git log -1 --oneline main
```

Expected: the stable branch matches its remote and the main branch contains the completed HMAC implementation. Stop rather than rebasing or merging if either branch diverges unexpectedly.

- [ ] **Step 2: Create the feature branch from stable**

Run:

```bash
git switch learning/next15-stable-caching
git switch -c feature/shopify-webhook-hmac-stable
```

Expected: the new branch starts at the exact stable branch HEAD, not at `main`.

- [ ] **Step 3: Cherry-pick the canonical spec commit**

Run:

```bash
git cherry-pick 688a743
```

If the commit is already reachable because documentation was previously ported, confirm identical file content with:

```bash
git diff main -- docs/specs/shopify-webhook-hmac.md
```

and skip only the duplicate cherry-pick. Do not resolve a substantive spec conflict by silently choosing one branch.

- [ ] **Step 4: Verify branch purity**

Run:

```bash
git merge-base --is-ancestor main HEAD && exit 1 || true
git grep -n '15.5.25' -- package.json pnpm-lock.yaml docs/specs/next15-stable-caching.md
git status --short --branch
```

Expected: the branch remains rooted in stable, Next `15.5.25` remains pinned, and only the spec commit differs so far.

---

### Task 2: Cherry-pick the reviewed shared verifier and handler

**Files:**

- Create via cherry-pick: `lib/shopify/webhook.ts`
- Create via cherry-pick: `lib/shopify/webhook.test.ts`

**Interfaces:**

- Consumes: exact main commits `feat: verify Shopify webhook signatures` and `feat: handle authenticated Shopify webhooks`
- Produces: the same `isValidShopifyWebhook`, `ShopifyWebhookDependencies`, and `handleShopifyWebhook` interfaces reviewed on main

- [ ] **Step 1: Resolve exact shared commit identities from main**

Run:

```bash
verifier_commit="$(git log feature/shopify-webhook-hmac-main --format='%H' \
  --grep='^feat: verify Shopify webhook signatures$' -n 1)"
handler_commit="$(git log feature/shopify-webhook-hmac-main --format='%H' \
  --grep='^feat: handle authenticated Shopify webhooks$' -n 1)"
test -n "$verifier_commit"
test -n "$handler_commit"
test "$(git show -s --format='%s' "$verifier_commit")" = \
  'feat: verify Shopify webhook signatures'
test "$(git show -s --format='%s' "$handler_commit")" = \
  'feat: handle authenticated Shopify webhooks'
printf 'verifier %s\nhandler  %s\n' "$verifier_commit" "$handler_commit"
```

Expected: exactly one latest commit resolves for each exact subject. If history contains ambiguity or the files differ from the independently reviewed main implementation, stop and obtain the reviewed hashes rather than guessing.

- [ ] **Step 2: Cherry-pick the shared commits in order**

Resolve the already-validated identities again in this shell and cherry-pick them:

```bash
verifier_commit="$(git log feature/shopify-webhook-hmac-main --format='%H' \
  --grep='^feat: verify Shopify webhook signatures$' -n 1)"
handler_commit="$(git log feature/shopify-webhook-hmac-main --format='%H' \
  --grep='^feat: handle authenticated Shopify webhooks$' -n 1)"
test -n "$verifier_commit" && test -n "$handler_commit"
git cherry-pick "$verifier_commit"
git cherry-pick "$handler_commit"
```

Resolve no cryptography or behavior conflict by hand. These files do not exist on the stable branch, so any content conflict indicates unexpected branch drift and is a stop condition.

- [ ] **Step 3: Verify byte-for-byte shared code identity**

Run:

```bash
git diff --exit-code origin/main -- \
  lib/shopify/webhook.ts \
  lib/shopify/webhook.test.ts
```

Expected: no diff. The stable branch may differ elsewhere but not in security verification or handler policy.

- [ ] **Step 4: Run the shared focused tests**

Run:

```bash
pnpm exec node --no-warnings --experimental-strip-types --test \
  lib/shopify/webhook.test.ts
```

Expected: every real-signature, tampering, malformed-input, error-contract, topic-mapping, and duplicate-delivery test passes unchanged.

---

### Task 3: Wire the stable invalidation adapter

**Files:**

- Modify: `app/api/revalidate/route.ts`
- Modify: `lib/shopify/index.ts`

**Interfaces:**

- Consumes: shared `handleShopifyWebhook`
- Produces: stable `POST /api/revalidate` adapter using `(tag) => revalidateTag(tag)`
- Removes: stable branch's exported legacy `revalidate(req)` implementation

- [ ] **Step 1: Replace the stable route adapter**

Replace `app/api/revalidate/route.ts` with:

```ts
import { handleShopifyWebhook } from "lib/shopify/webhook";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest): Promise<Response> {
  return handleShopifyWebhook({
    request,
    secret: process.env.SHOPIFY_WEBHOOK_SECRET,
    revalidateTag: (tag) => revalidateTag(tag),
    reportError: (message) => console.error(message),
  });
}
```

Do not copy the main adapter's second `"seconds"` argument.

- [ ] **Step 2: Remove legacy webhook logic from the Shopify data module**

Delete the exported `revalidate` function from `lib/shopify/index.ts`. Remove only imports made unused by that deletion:

```text
revalidateTag from next/cache
headers from next/headers
NextRequest and NextResponse from next/server
```

Keep `cookies`, `getShopifyCacheOptions`, `createShopifyRequestInit`, every
catalog/cart call site, and all GraphQL operations unchanged.

- [ ] **Step 3: Prove stable API separation and legacy removal**

Run:

```bash
! grep -RIn --exclude-dir=node_modules --exclude-dir=.next \
  'SHOPIFY_REVALIDATION_SECRET\|nextUrl.searchParams.get("secret")' \
  app lib
! grep -RIn --exclude-dir=node_modules --exclude-dir=.next \
  'revalidateTag([^)]*,[[:space:]]*"seconds"' \
  app lib
```

Expected: both commands exit 0 with no matches.

- [ ] **Step 4: Run stable route gates**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

Expected: all tests and formatting pass, TypeScript accepts the stable adapter, Next `15.5.25` builds, and storefront routes remain dynamically rendered because the root layout reads cart cookies.

- [ ] **Step 5: Commit the stable adapter**

Run:

```bash
git add app/api/revalidate/route.ts lib/shopify/index.ts
git diff --cached --check
git commit -m "refactor: authenticate stable Shopify webhook route"
```

---

### Task 4: Port configuration and documentation without canary drift

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Create from accepted main content: `docs/intent/shopify-webhooks.md`
- Modify: `docs/learning/next15-stable-caching.md`
- Modify: `tasks/shopify-webhook-hmac/stable-plan.md` only to record completed checkboxes/evidence

**Interfaces:**

- Documents: stable adapter, common HMAC contract, manual signing secret, protected Preview, and separate-branch decision
- Removes: stable branch's legacy query-secret documentation

- [ ] **Step 1: Replace the environment template variable**

In `.env.example`, replace:

```text
SHOPIFY_REVALIDATION_SECRET=""
```

with:

```text
SHOPIFY_WEBHOOK_SECRET=""
```

Do not copy a real Vercel or local value.

- [ ] **Step 2: Port the accepted Shopify intent record**

Copy the reviewed intent document from main without using the working tree as an intermediary:

```bash
intent_file="$(mktemp)"
git show origin/main:docs/intent/shopify-webhooks.md > "$intent_file"
test -s "$intent_file"
mv "$intent_file" docs/intent/shopify-webhooks.md
```

Read it completely and adjust only statements that explicitly describe the active branch adapter. The common authentication, threat, external configuration, and rollback decisions must remain identical.

- [ ] **Step 3: Update stable README and interview notes**

Update `README.md` and `docs/learning/next15-stable-caching.md` to state:

- Shopify manual webhooks are authenticated with the store-level signing secret and exact raw-body HMAC.
- `SHOPIFY_WEBHOOK_SECRET` is required; the Storefront token is unrelated.
- No secret appears in the Production webhook URL.
- Protected Preview webhooks use only a temporary Vercel automation-bypass query parameter.
- Invalid signatures return HTTP 401 and cannot invalidate tags.
- The stable route injects one-argument `revalidateTag(tag)`.
- The shared verifier/test files remain byte-identical to main.
- Both maintained branches remain separate.

Remove every statement that says Shopify uses a shared query-string secret or always responds with HTTP 200 to invalid authentication.

- [ ] **Step 4: Format, test, and scan documentation**

Run:

```bash
pnpm prettier
pnpm test
pnpm exec tsc --noEmit
git diff --check
! grep -RIn --exclude-dir=node_modules --exclude-dir=.next \
  'SHOPIFY_REVALIDATION_SECRET\|nextUrl.searchParams.get("secret")' \
  app lib README.md .env.example docs
! git diff learning/next15-stable-caching...HEAD -- . ':!pnpm-lock.yaml' | \
  grep -Ein \
  'secret=[A-Za-z0-9]|x-vercel-protection-bypass=[A-Za-z0-9]|SHOPIFY_WEBHOOK_SECRET="[^"]+'
```

Expected: all checks pass with no legacy contract or concrete secret material.

- [ ] **Step 5: Commit stable configuration and documentation**

Run:

```bash
git add .env.example README.md docs/intent/shopify-webhooks.md \
  docs/learning/next15-stable-caching.md \
  tasks/shopify-webhook-hmac/stable-plan.md
git diff --cached --check
git commit -m "docs: document stable Shopify webhook HMAC"
```

---

### Task 5: Complete stable local security and independent review

**Files:**

- Review only: `learning/next15-stable-caching...HEAD`
- Modify only for accepted, test-backed review findings

**Interfaces:**

- Verifies: stable branch implementation against the canonical spec and accepted main shared files

- [ ] **Step 1: Run fresh clean-HEAD verification**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm audit --audit-level high
git diff --check
git status --short
```

Record exact test count, build route classifications, audit findings, and clean status. Compare audit output with the stable parent; this dependency-free port must introduce no advisory.

- [ ] **Step 2: Verify shared identity and stable-only APIs**

Run:

```bash
git diff --exit-code origin/main -- \
  lib/shopify/webhook.ts \
  lib/shopify/webhook.test.ts
! grep -RIn --exclude-dir=node_modules --exclude-dir=.next \
  'revalidateTag([^)]*,[[:space:]]*"seconds"\|SHOPIFY_REVALIDATION_SECRET\|nextUrl.searchParams.get("secret")' \
  app lib
```

Expected: security files are byte-identical and the stable runtime contains no canary invalidation or legacy authentication.

- [ ] **Step 3: Request a stable-focused read-only review**

Give the reviewer the exact parent and HEAD commits plus changed-file list. Require findings on:

- Byte-for-byte identity with the main verifier/handler.
- Stable one-argument invalidation adapter.
- Raw body, timing-safe equality, authentication ordering, topic allowlist, status contract, and secret-safe logs.
- Preservation of explicit catalog caching and private cart `no-store` behavior.
- Documentation accuracy, dependency neutrality, and branch isolation.

Resolve every Critical or Required finding test-first and rerun Steps 1–2. Obtain focused re-review after any runtime correction.

- [ ] **Step 4: Commit accepted review corrections separately**

Use a narrow commit message and confirm:

```bash
test -z "$(git status --short)"
```

---

### Task 6: Verify Preview and merge only into stable

**Files:**

- No source changes unless a reproduced defect requires a test-first fix
- Update stable plan/checklist documentation with owner-attested external evidence

**Interfaces:**

- External: stable feature branch Preview, Shopify manual webhooks, Vercel protection, stable parent merge

- [ ] **Step 1: Obtain approval and push only the stable feature branch**

Run only after owner approval:

```bash
git push --set-upstream origin feature/shopify-webhook-hmac-stable
```

Do not push or merge to `main`.

- [ ] **Step 2: Confirm stable Preview environment and deployment**

Verify without exposing values:

- `SHOPIFY_WEBHOOK_SECRET` exists in Preview scope.
- The branch deploys with Next `15.5.25` and a supported Node runtime.
- The stable branch alias points to the latest successful deployment.
- Existing Sanity and Shopify storefront environment values remain available.

Redeploy after any environment change.

- [ ] **Step 3: Obtain approval for temporary Shopify subscriptions**

Create a new short-lived Vercel automation bypass. In Shopify Admin create temporary manual JSON Product update and Collection update subscriptions. Set each destination to the exact stable feature branch alias, `/api/revalidate`, and the generated `x-vercel-protection-bypass` query parameter. Do not add a legacy application secret and do not alter Production subscriptions.

- [ ] **Step 4: Perform stable Preview acceptance**

For approved reversible test data:

1. Warm a Preview product and collection page.
2. Update one product and confirm a genuine HTTP 200 delivery.
3. Hard-reload and confirm the product cache is fresh.
4. Update one collection and confirm a genuine HTTP 200 delivery.
5. Hard-reload and confirm the collection cache is fresh.
6. Revert both changes and confirm the reverse deliveries/refreshes.
7. Send an invalid-signature request through the protected endpoint and confirm a real HTTP 401 with no invalidation.
8. Verify cart creation and two-session cart isolation remain unchanged.
9. Inspect Vercel logs for generic outcomes only; no body, HMAC, or secret may appear.

Record browser checks as owner-attested unless an approved isolated browser tool captures them.

- [ ] **Step 5: Remove temporary Preview infrastructure**

Delete the temporary Product and Collection subscriptions and revoke the Vercel automation bypass. Confirm no concrete bypass remains in Shopify configuration, logs copied into the repository, or local files.

- [ ] **Step 6: Obtain approval and merge only into the stable parent**

Present:

- Exact reviewed feature HEAD.
- Local test/type/build/audit evidence.
- Preview product/collection/HMAC evidence.
- Remaining limitations and rollback instructions.
- Proof that shared security files match main and only the adapter differs.

After explicit approval, merge into `learning/next15-stable-caching`. Do not merge to `main` and do not promote the Preview to Production.

- [ ] **Step 7: Verify the updated stable branch Preview**

Confirm the stable branch alias advances to the merged commit and repeats one non-destructive signed webhook delivery. Remove any temporary subscription/bypass created for this final check.

- [ ] **Step 8: Record completion and preserve both branches**

Update documentation with exact commits and owner-attested evidence, rerun formatting/tests for any documentation commit, push the stable branch, and verify:

```bash
test "$(git rev-parse main)" = "$(git rev-parse origin/main)"
test "$(git rev-parse learning/next15-stable-caching)" = \
  "$(git rev-parse origin/learning/next15-stable-caching)"
test -z "$(git status --short)"
```

Both branches must remain present and separate.
