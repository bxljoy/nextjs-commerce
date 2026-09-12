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
