import { isValidSignature, SIGNATURE_HEADER_NAME } from "@sanity/webhook";
import type { NextRequest } from "next/server";

export const SANITY_CACHE_TAGS = {
  pages: "pages",
  posts: "posts",
} as const;

type ParsedSanityWebhook = {
  body: { _type?: unknown } | null;
  isValidSignature: boolean | null;
};

/**
 * Verify the exact bytes Sanity signed before parsing JSON. A valid event can
 * briefly arrive before the corresponding Content Lake query is consistent.
 *
 * Source: https://github.com/sanity-io/webhook-toolkit#usage-with-nextjs
 */
export async function parseSanityWebhook(
  request: NextRequest,
  secret: string,
  waitForContentLakeEventualConsistency = true,
): Promise<ParsedSanityWebhook> {
  const signature = request.headers.get(SIGNATURE_HEADER_NAME);

  if (!signature) {
    return { body: null, isValidSignature: null };
  }

  const rawBody = await request.text();
  const validSignature = await isValidSignature(
    rawBody,
    signature,
    secret.trim(),
  );

  if (!validSignature) {
    return { body: null, isValidSignature: false };
  }

  if (waitForContentLakeEventualConsistency) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return {
    body: rawBody.trim() ? JSON.parse(rawBody) : null,
    isValidSignature: true,
  };
}

export type SanityWebhookDependencies = {
  request: NextRequest;
  secret: string | undefined;
  parseBody: (
    request: NextRequest,
    secret: string,
    waitForContentLakeEventualConsistency: boolean,
  ) => Promise<ParsedSanityWebhook>;
  revalidateTag: (tag: string) => void;
  reportError: (message: string) => void;
};

export async function handleSanityWebhook({
  request,
  secret,
  parseBody,
  revalidateTag,
  reportError,
}: SanityWebhookDependencies): Promise<Response> {
  if (!secret) {
    reportError("SANITY_REVALIDATE_SECRET is not configured");
    return Response.json(
      { error: "Webhook revalidation is not configured" },
      { status: 500 },
    );
  }

  let parsed: ParsedSanityWebhook;

  try {
    parsed = await parseBody(request, secret, true);
  } catch {
    reportError("Invalid Sanity webhook payload");
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  if (parsed.isValidSignature !== true) {
    reportError("Invalid Sanity webhook signature");
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const tag =
    parsed.body?._type === "page"
      ? SANITY_CACHE_TAGS.pages
      : parsed.body?._type === "post"
        ? SANITY_CACHE_TAGS.posts
        : undefined;

  if (!tag) {
    return Response.json(
      { error: "Unsupported document type" },
      { status: 400 },
    );
  }

  revalidateTag(tag);

  return Response.json({ revalidated: true, tags: [tag] });
}
