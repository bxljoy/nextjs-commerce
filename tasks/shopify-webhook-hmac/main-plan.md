# Shopify Webhook HMAC — Main/Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `main`'s query-string Shopify webhook authentication with raw-body `X-Shopify-Hmac-Sha256` verification and retain its canary cache invalidation semantics.

**Architecture:** A framework-independent module verifies exact request bytes and maps authenticated Shopify topics to `products` or `collections`. The route injects `main`'s `revalidateTag(tag, "seconds")` adapter. The legacy handler and environment variable are removed rather than retained as a fallback; the owner accepts the temporary external revalidation gap.

**Tech Stack:** Next.js `15.6.0-canary.60`, TypeScript `5.8.2`, Node `node:crypto`, Node built-in test runner, Vercel Preview, manually configured Shopify Admin webhooks.

**Spec:** `docs/specs/shopify-webhook-hmac.md`

## Global Constraints

- Work only on `feature/shopify-webhook-hmac-main`, based on current `origin/main`.
- Do not add dependencies; use `createHmac` and `timingSafeEqual` from `node:crypto`.
- Verify `request.arrayBuffer()` bytes before decoding, parsing, topic handling, or invalidation.
- Never print, log, commit, paste, or screenshot a real signing secret, HMAC, payload, legacy secret, or Vercel bypass.
- Keep `POST /api/revalidate` and exactly six supported product/collection topics.
- Use only `main`'s `revalidateTag(tag, "seconds")` signature.
- Do not modify Sanity behavior, Shopify catalog/cart transport, UI, or dependencies.
- Stop for owner approval before creating Shopify subscriptions, changing Vercel protection, pushing, merging, or touching Production.
- Preserve the named stash `user-shopify-webhook-secret-env-change` until its exact `.env.example` change is committed.
- Keep `feature/shopify-webhook-hmac-main` locally until the stable branch has cherry-picked and verified the shared commits, even if the main merge is squashed.

---

### Task 1: Implement the shared HMAC verifier

**Files:**

- Create: `lib/shopify/webhook.ts`
- Create: `lib/shopify/webhook.test.ts`

**Interfaces:**

- Produces: `isValidShopifyWebhook(rawBody: Uint8Array, signature: string, secret: string): boolean`
- Depends on: `node:crypto` only

- [ ] **Step 1: Create a non-implementing module scaffold**

Create `lib/shopify/webhook.ts` with only:

```ts
export {};
```

This lets the test import the wished-for API and fail on the missing export rather than module resolution.

- [ ] **Step 2: Write the failing verifier tests**

Create `lib/shopify/webhook.test.ts` with a test-local signer independent of production code:

```ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import * as webhookModule from "./webhook.ts";

type IsValidShopifyWebhook = (
  rawBody: Uint8Array,
  signature: string,
  secret: string,
) => boolean;

const isValidShopifyWebhook = (
  webhookModule as unknown as {
    isValidShopifyWebhook?: IsValidShopifyWebhook;
  }
).isValidShopifyWebhook;

const encoder = new TextEncoder();
const secret = "test-store-signing-secret";
const rawBody = encoder.encode('{"id":123,"title":"Updated product"}');
const sign = (body: Uint8Array, signingSecret = secret) =>
  createHmac("sha256", signingSecret).update(body).digest("base64");

test("accepts Shopify's HMAC for the exact raw body bytes", () => {
  assert.equal(typeof isValidShopifyWebhook, "function");
  assert.equal(isValidShopifyWebhook!(rawBody, sign(rawBody), secret), true);
});

test("rejects body changes and another signing secret", () => {
  assert.equal(
    isValidShopifyWebhook!(
      encoder.encode('{"id":123, "title":"Updated product"}'),
      sign(rawBody),
      secret,
    ),
    false,
  );
  assert.equal(
    isValidShopifyWebhook!(rawBody, sign(rawBody, "other-secret"), secret),
    false,
  );
});

test("rejects empty, malformed, truncated, and equal-length invalid signatures", () => {
  assert.equal(isValidShopifyWebhook!(rawBody, "", secret), false);
  assert.equal(isValidShopifyWebhook!(rawBody, "not-base64", secret), false);
  assert.equal(
    isValidShopifyWebhook!(rawBody, sign(rawBody).slice(0, -4), secret),
    false,
  );
  assert.equal(
    isValidShopifyWebhook!(rawBody, "A".repeat(sign(rawBody).length), secret),
    false,
  );
});
```

- [ ] **Step 3: Run the verifier tests and observe RED**

Run:

```bash
pnpm exec node --no-warnings --experimental-strip-types --test lib/shopify/webhook.test.ts
```

Expected: tests fail because `isValidShopifyWebhook` is undefined. A syntax or module-resolution error is not the expected failure; fix the test harness until it reaches the assertion.

- [ ] **Step 4: Implement the minimal verifier**

Replace the scaffold in `lib/shopify/webhook.ts` with:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function isValidShopifyWebhook(
  rawBody: Uint8Array,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const expected = Buffer.from(
    createHmac("sha256", secret).update(rawBody).digest("base64"),
    "utf8",
  );
  const received = Buffer.from(signature, "utf8");

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
```

Comparing the canonical base64 text as equal-length bytes rejects malformed or differently encoded input without relying on Node's permissive base64 decoder.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec node --no-warnings --experimental-strip-types --test lib/shopify/webhook.test.ts
```

Expected: all verifier tests pass with no warning or secret output.

- [ ] **Step 6: Commit the portable verifier slice**

Run:

```bash
git add lib/shopify/webhook.ts lib/shopify/webhook.test.ts
git diff --cached --check
git commit -m "feat: verify Shopify webhook signatures"
```

Record this commit hash with `git rev-parse HEAD`; the stable plan locates this commit by its exact subject for cherry-picking.

---

### Task 2: Implement authenticated topic handling

**Files:**

- Modify: `lib/shopify/webhook.ts`
- Modify: `lib/shopify/webhook.test.ts`

**Interfaces:**

- Produces: `ShopifyCacheTag`, `ShopifyWebhookDependencies`, and `handleShopifyWebhook(dependencies): Promise<Response>`
- Consumes: `isValidShopifyWebhook` from Task 1
- Injects: branch-specific `(tag: ShopifyCacheTag) => void`

- [ ] **Step 1: Add handler types and test helpers before production code**

Append test-local definitions to `lib/shopify/webhook.test.ts` using optional module casts so the test fails on the missing handler:

```ts
type ShopifyCacheTag = "products" | "collections";
type ShopifyWebhookDependencies = {
  request: Request;
  secret: string | undefined;
  revalidateTag: (tag: ShopifyCacheTag) => void;
  reportError: (message: string) => void;
};
type HandleShopifyWebhook = (
  dependencies: ShopifyWebhookDependencies,
) => Promise<Response>;

const handleShopifyWebhook = (
  webhookModule as unknown as {
    handleShopifyWebhook?: HandleShopifyWebhook;
  }
).handleShopifyWebhook;

function signedRequest(topic: string, body = '{"id":123}') {
  const bytes = encoder.encode(body);
  return new Request("https://example.com/api/revalidate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": sign(bytes),
      "x-shopify-topic": topic,
      "x-shopify-webhook-id": "test-webhook-id",
    },
    body,
  });
}
```

- [ ] **Step 2: Add failing authentication and failure-contract tests**

Add tests proving:

```ts
test("fails closed when the Shopify signing secret is missing", async () => {
  assert.equal(typeof handleShopifyWebhook, "function");
  const invalidated: ShopifyCacheTag[] = [];
  const errors: string[] = [];
  const response = await handleShopifyWebhook!({
    request: signedRequest("products/update"),
    secret: undefined,
    revalidateTag: (tag) => invalidated.push(tag),
    reportError: (message) => errors.push(message),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Webhook revalidation is not configured",
  });
  assert.deepEqual(invalidated, []);
  assert.deepEqual(errors, ["SHOPIFY_WEBHOOK_SECRET is not configured"]);
});

test("rejects a missing or invalid HMAC without invalidation", async () => {
  for (const signature of [undefined, "invalid-signature"]) {
    const request = new Request("https://example.com/api/revalidate", {
      method: "POST",
      headers: {
        ...(signature ? { "x-shopify-hmac-sha256": signature } : {}),
        "x-shopify-topic": "products/update",
      },
      body: '{"id":123}',
    });
    const invalidated: ShopifyCacheTag[] = [];
    const response = await handleShopifyWebhook!({
      request,
      secret,
      revalidateTag: (tag) => invalidated.push(tag),
      reportError: () => {},
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Invalid Shopify webhook signature",
    });
    assert.deepEqual(invalidated, []);
  }
});
```

Also add a failure-invalidation test whose injected `revalidateTag` throws. Expect HTTP 500, `{ error: "Webhook revalidation failed" }`, one generic report, and no secret/body/signature in either public or reported error text.

- [ ] **Step 3: Add failing exact-topic mapping tests**

Use table-driven tests for all six allowed topics:

```ts
const topicCases: [string, ShopifyCacheTag][] = [
  ["collections/create", "collections"],
  ["collections/delete", "collections"],
  ["collections/update", "collections"],
  ["products/create", "products"],
  ["products/delete", "products"],
  ["products/update", "products"],
];

for (const [topic, expectedTag] of topicCases) {
  test(`maps ${topic} only to ${expectedTag}`, async () => {
    const invalidated: ShopifyCacheTag[] = [];
    const response = await handleShopifyWebhook!({
      request: signedRequest(topic),
      secret,
      revalidateTag: (tag) => invalidated.push(tag),
      reportError: () => {},
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 200);
    assert.equal(body.revalidated, true);
    assert.equal(typeof body.now, "number");
    assert.deepEqual(invalidated, [expectedTag]);
  });
}
```

Add valid `orders/create` and `constructor` tests, each expecting HTTP 200, `{ status: 200 }`, and no invalidation. The `constructor` case proves lookup cannot escape the exact allowlist through object-prototype properties. Call one valid supported request twice with two fresh `Request` instances and assert the same tag can be invalidated twice without handler failure.

- [ ] **Step 4: Run the handler tests and observe RED**

Run:

```bash
pnpm exec node --no-warnings --experimental-strip-types --test lib/shopify/webhook.test.ts
```

Expected: verifier tests pass and handler tests fail because `handleShopifyWebhook` is undefined.

- [ ] **Step 5: Implement the handler and allowlist**

Append to `lib/shopify/webhook.ts`:

```ts
export type ShopifyCacheTag = "products" | "collections";

const SHOPIFY_TOPIC_TAGS = new Map<string, ShopifyCacheTag>([
  ["collections/create", "collections"],
  ["collections/delete", "collections"],
  ["collections/update", "collections"],
  ["products/create", "products"],
  ["products/delete", "products"],
  ["products/update", "products"],
]);

export type ShopifyWebhookDependencies = {
  request: Request;
  secret: string | undefined;
  revalidateTag: (tag: ShopifyCacheTag) => void;
  reportError: (message: string) => void;
};

export async function handleShopifyWebhook({
  request,
  secret,
  revalidateTag,
  reportError,
}: ShopifyWebhookDependencies): Promise<Response> {
  if (!secret) {
    reportError("SHOPIFY_WEBHOOK_SECRET is not configured");
    return Response.json(
      { error: "Webhook revalidation is not configured" },
      { status: 500 },
    );
  }

  const signature = request.headers.get("x-shopify-hmac-sha256");
  const rawBody = new Uint8Array(await request.arrayBuffer());

  if (!signature || !isValidShopifyWebhook(rawBody, signature, secret)) {
    reportError("Invalid Shopify webhook signature");
    return Response.json(
      { error: "Invalid Shopify webhook signature" },
      { status: 401 },
    );
  }

  const topic = request.headers.get("x-shopify-topic") || "unknown";
  const tag = SHOPIFY_TOPIC_TAGS.get(topic);
  if (!tag) return Response.json({ status: 200 });

  try {
    revalidateTag(tag);
  } catch {
    reportError("Shopify webhook revalidation failed");
    return Response.json(
      { error: "Webhook revalidation failed" },
      { status: 500 },
    );
  }

  return Response.json({
    status: 200,
    revalidated: true,
    now: Date.now(),
  });
}
```

- [ ] **Step 6: Run focused and complete unit tests**

Run:

```bash
pnpm exec node --no-warnings --experimental-strip-types --test lib/shopify/webhook.test.ts
pnpm test:unit
```

Expected: all tests pass. Confirm no test output contains a secret, signature, or raw body.

- [ ] **Step 7: Commit the shared handler policy**

Run:

```bash
git add lib/shopify/webhook.ts lib/shopify/webhook.test.ts
git diff --cached --check
git commit -m "feat: handle authenticated Shopify webhooks"
```

---

### Task 3: Wire the main/canary route and remove legacy authentication

**Files:**

- Modify: `app/api/revalidate/route.ts`
- Modify: `lib/shopify/index.ts`

**Interfaces:**

- Consumes: `handleShopifyWebhook` from `lib/shopify/webhook.ts`
- Produces: `POST /api/revalidate` using `revalidateTag(tag, "seconds")`
- Removes: exported `revalidate(req)` and query-secret authentication from `lib/shopify/index.ts`

- [ ] **Step 1: Replace the route adapter**

Replace `app/api/revalidate/route.ts` with:

```ts
import { handleShopifyWebhook } from "lib/shopify/webhook";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest): Promise<Response> {
  return handleShopifyWebhook({
    request,
    secret: process.env.SHOPIFY_WEBHOOK_SECRET,
    revalidateTag: (tag) => revalidateTag(tag, "seconds"),
    reportError: (message) => console.error(message),
  });
}
```

- [ ] **Step 2: Remove the legacy handler from the Shopify data module**

Delete the entire exported `revalidate` function from `lib/shopify/index.ts`.
Remove its now-unused imports:

```ts
// Remove revalidateTag from next/cache imports.
// Remove headers from next/headers imports; keep cookies.
// Remove NextRequest and NextResponse from next/server imports.
```

Do not alter any catalog, collection, product, cart, GraphQL, cache directive, or reshaping code in this task.

- [ ] **Step 3: Prove legacy authentication is absent**

Run:

```bash
! grep -RIn --exclude-dir=node_modules --exclude-dir=.next \
  'nextUrl.searchParams.get("secret")\|SHOPIFY_REVALIDATION_SECRET' \
  app lib
```

Expected: exit 0 with no matches.

- [ ] **Step 4: Run route integration gates**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

Expected: all tests and formatting pass; TypeScript passes; the canary production build succeeds with its existing PPR/cache classifications.

- [ ] **Step 5: Commit the main adapter**

Run:

```bash
git add app/api/revalidate/route.ts lib/shopify/index.ts
git diff --cached --check
git commit -m "refactor: authenticate Shopify webhook route"
```

---

### Task 4: Update configuration and operational documentation

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/intent/shopify-webhooks.md`
- Modify: `tasks/shopify-webhook-hmac/main-plan.md` only to record completed checkboxes/evidence

**Interfaces:**

- Documents: `SHOPIFY_WEBHOOK_SECRET`, manual Shopify signing-secret source, Preview protection, response behavior, cleanup, and rollback
- Removes: documented `SHOPIFY_REVALIDATION_SECRET` contract

- [ ] **Step 1: Apply the approved environment-template change**

Set `.env.example` to contain:

```text
SHOPIFY_WEBHOOK_SECRET=""
```

and no `SHOPIFY_REVALIDATION_SECRET` entry. Before editing, confirm the preserved user stash still contains only this intended one-line replacement:

```bash
git stash list --format='%gd %s' | grep 'user-shopify-webhook-secret-env-change'
git stash show -p stash@{0} -- .env.example
```

If `stash@{0}` no longer names that message, locate the exact stash by message before inspecting it. Do not apply any unrelated stash.

- [ ] **Step 2: Update README configuration and webhook guidance**

Replace the query-secret description with these facts:

- `SHOPIFY_WEBHOOK_SECRET` is required for Shopify cache revalidation.
- Manual Admin webhooks use the store-level signing value shown on Shopify's Webhooks page.
- The Storefront access token and app client secret are not substitutes for these manual subscriptions.
- Production webhook URL is
  `https://nextjs-commerce-sigma-hazel-95.vercel.app/api/revalidate` with no
  application secret in the query.
- Protected Preview subscriptions use a temporary Vercel automation-bypass query parameter, which is separate from Shopify HMAC authentication.
- Invalid signatures return HTTP 401; missing server configuration returns 500; valid supported topics return 200.

Do not include real URL query values or signing material.

- [ ] **Step 3: Record the architectural decision**

Create `docs/intent/shopify-webhooks.md` with:

- Status and date.
- Context: legacy URL secret, exposed URL/log risk, no body integrity.
- Decision: raw-byte Shopify HMAC using the manual store signing secret.
- Alternatives rejected: retaining query secret; permanent dual auth; adding Shopify SDK; adding a replay database.
- Consequences: real non-2xx auth/config failures, same store secret in Preview/Production, temporary Vercel bypass for protected Preview, branch-specific invalidation adapters.
- Migration and rollback sequence from the approved spec.

- [ ] **Step 4: Format and validate documentation**

Run:

```bash
pnpm prettier
pnpm test
git diff --check
! git diff -- . ':!pnpm-lock.yaml' | grep -Ein \
  'secret=[A-Za-z0-9]|x-vercel-protection-bypass=[A-Za-z0-9]|SHOPIFY_WEBHOOK_SECRET="[^"]+'
```

Expected: formatting/tests pass and the secret scan returns no matches.

- [ ] **Step 5: Commit configuration and documentation**

Run:

```bash
git add .env.example README.md docs/intent/shopify-webhooks.md \
  tasks/shopify-webhook-hmac/main-plan.md
git diff --cached --check
git commit -m "docs: document Shopify webhook HMAC"
```

After confirming `.env.example` is committed correctly and the named stash has no other files, drop only that exact stash. If its identity is ambiguous, leave it intact and report it instead of guessing.

---

### Task 5: Complete local security and review gates

**Files:**

- Review only: complete `BASE..HEAD` diff
- Modify only if an accepted review finding requires a tested fix

**Interfaces:**

- Verifies the implementation against `docs/specs/shopify-webhook-hmac.md`

- [ ] **Step 1: Run fresh verification from clean HEAD**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm audit --audit-level high
git diff --check
git status --short
```

Record exact test count, build route classifications, audit findings, and whether the worktree is clean. A non-zero audit is not silently ignored; compare it with `main` and identify whether this dependency-free change introduced anything.

- [ ] **Step 2: Run focused security scans**

Run:

```bash
! grep -RIn --exclude-dir=node_modules --exclude-dir=.next \
  'SHOPIFY_REVALIDATION_SECRET\|nextUrl.searchParams.get("secret")' \
  app lib README.md .env.example docs

git diff main...HEAD -- . ':!pnpm-lock.yaml' | grep -Ein \
  'secret=[A-Za-z0-9]|x-vercel-protection-bypass=[A-Za-z0-9]|BEGIN .* PRIVATE KEY|SHOPIFY_WEBHOOK_SECRET="[^"]+' \
  && exit 1 || true
```

Expected: no legacy authentication and no concrete credential material.

- [ ] **Step 3: Request an independent read-only review**

Provide the reviewer with the exact `main...HEAD` changed-file list and ask it to inspect:

- Raw-byte fidelity and HMAC correctness.
- Constant-time comparison and malformed input behavior.
- Authentication-before-topic ordering.
- Exact six-topic allowlist.
- Error status/body contract and secret-safe logs.
- Main-only `revalidateTag(tag, "seconds")` wiring.
- Removal of legacy URL authentication.
- Tests first, docs accuracy, dependencies, and rollback safety.

Resolve every Critical or Required finding test-first, rerun Step 1, and request focused re-review.

- [ ] **Step 4: Commit accepted review fixes separately**

Use a narrow commit message describing the verified root issue, then confirm:

```bash
test -z "$(git status --short)"
```

---

### Task 6: Preview, merge, and Production cutover

**Files:**

- No source changes unless a reproduced defect requires a test-first fix
- Record owner-attested external evidence in plan/checklist documentation after testing

**Interfaces:**

- External: Vercel Preview, Shopify manual webhook delivery, GitHub merge, Production cache invalidation

- [ ] **Step 1: Obtain explicit approval and push only the feature branch**

Run only after owner approval:

```bash
git push --set-upstream origin feature/shopify-webhook-hmac-main
```

Do not merge or alter Production in this step.

- [ ] **Step 2: Verify Vercel environment and branch deployment without exposing values**

Confirm `SHOPIFY_WEBHOOK_SECRET` exists for Preview and Production scopes and that the Preview deployment uses a supported Node runtime. Redeploy after any environment change.

- [ ] **Step 3: Obtain approval for temporary Shopify subscriptions and bypass**

Create a dedicated short-lived Vercel automation bypass. In Shopify Admin create temporary manual JSON subscriptions for:

- Product update.
- Collection update.

Use the exact feature branch alias shown by `vercel inspect`, append the
`/api/revalidate` path, and set `x-vercel-protection-bypass` to the generated
value in Shopify's destination query. Never paste or commit the resulting
concrete URL. Do not modify existing Production subscriptions.

- [ ] **Step 4: Perform Preview acceptance**

For one approved test product and collection:

1. Warm the corresponding Preview page.
2. Make a reversible Shopify change.
3. Confirm Shopify reports HTTP 200 from the feature webhook.
4. Hard-reload Preview and confirm fresh content.
5. Revert the Shopify change and confirm the second delivery/refresh.
6. Send or replay an invalid-signature request and confirm HTTP 401 with no invalidation.
7. Check Vercel logs contain no raw body, HMAC, or secret.

Record these as owner-attested unless captured by an approved browser tool.

- [ ] **Step 5: Remove Preview infrastructure**

Delete the two temporary Shopify subscriptions and revoke the Vercel automation bypass. Confirm the branch Preview remains accessible to authorized humans and Production subscriptions remain unchanged.

- [ ] **Step 6: Obtain independent final approval before merge**

Present local evidence, Preview evidence, remaining audit findings, rollback instructions, and the exact reviewed HEAD. Merge only after explicit owner approval.

- [ ] **Step 7: Verify Production immediately after merge**

The owner performs one reversible Product update and Collection update. Confirm:

- Existing webhook subscriptions return HTTP 200 using HMAC even without legacy query parameters.
- Product and collection cache tags refresh visible Production content.
- Invalid signatures return a real HTTP 401.
- No secret material appears in logs.

If valid Shopify deliveries fail, redeploy the last HMAC commit after correcting `SHOPIFY_WEBHOOK_SECRET`; use the emergency legacy rollback sequence from the spec only if HMAC cannot be restored promptly.

- [ ] **Step 8: Retire the legacy environment value**

After the owner-approved rollback window, remove `SHOPIFY_REVALIDATION_SECRET` from Vercel Production and Preview. The exposed value is never reused. Record removal without recording its value.

- [ ] **Step 9: Record main-track completion**

Update the plan/checklist with exact commits and evidence, run the clean-HEAD local verification once more if documentation changed, and leave `main` clean and synchronized with `origin/main`. Keep the local feature branch and its reviewed shared commits until the stable port is complete.
