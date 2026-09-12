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
