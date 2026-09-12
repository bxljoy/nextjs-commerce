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
