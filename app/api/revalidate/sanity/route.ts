import { handleSanityWebhook } from "lib/sanity/webhook";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { parseBody } from "next-sanity/webhook";

export async function POST(request: NextRequest): Promise<Response> {
  return handleSanityWebhook({
    request,
    secret: process.env.SANITY_REVALIDATE_SECRET,
    parseBody,
    // A webhook runs in a Route Handler, where updateTag is unavailable.
    // expire: 0 makes the next visitor block for fresh content.
    revalidateTag: (tag) => revalidateTag(tag, { expire: 0 }),
    reportError: (message) => console.error(message),
  });
}
