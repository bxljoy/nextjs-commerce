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
