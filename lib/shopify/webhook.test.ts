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

test("returns a generic error when cache invalidation fails", async () => {
  const errors: string[] = [];
  const response = await handleShopifyWebhook!({
    request: signedRequest("products/update"),
    secret,
    revalidateTag: () => {
      throw new Error("private invalidation detail");
    },
    reportError: (message) => errors.push(message),
  });

  assert.equal(response.status, 500);
  const responseBody = await response.json();
  assert.deepEqual(responseBody, { error: "Webhook revalidation failed" });
  assert.deepEqual(errors, ["Shopify webhook revalidation failed"]);
  const exposedText = JSON.stringify(responseBody) + errors.join("");
  assert.equal(exposedText.includes(secret), false);
  assert.equal(exposedText.includes('{"id":123}'), false);
  assert.equal(exposedText.includes(sign(encoder.encode('{"id":123}'))), false);
});

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

for (const topic of ["orders/create", "constructor"]) {
  test(`accepts unsupported topic ${topic} without invalidation`, async () => {
    const invalidated: ShopifyCacheTag[] = [];
    const response = await handleShopifyWebhook!({
      request: signedRequest(topic),
      secret,
      revalidateTag: (tag) => invalidated.push(tag),
      reportError: () => {},
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 200 });
    assert.deepEqual(invalidated, []);
  });
}

test("allows duplicate valid deliveries to repeat an idempotent invalidation", async () => {
  const invalidated: ShopifyCacheTag[] = [];

  for (let delivery = 0; delivery < 2; delivery += 1) {
    const response = await handleShopifyWebhook!({
      request: signedRequest("products/update"),
      secret,
      revalidateTag: (tag) => invalidated.push(tag),
      reportError: () => {},
    });
    assert.equal(response.status, 200);
  }

  assert.deepEqual(invalidated, ["products", "products"]);
});
