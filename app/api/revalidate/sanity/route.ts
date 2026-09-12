import { handleSanityWebhook, parseSanityWebhook } from "lib/sanity/webhook";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest): Promise<Response> {
  return handleSanityWebhook({
    request,
    secret: process.env.SANITY_REVALIDATE_SECRET,
    parseBody: parseSanityWebhook,
    // In Next.js 15, revalidateTag marks this data stale. The next visitor
    // performs the fresh read; the webhook does not eagerly refetch it.
    revalidateTag,
    reportError: (message) => console.error(message),
  });
}
