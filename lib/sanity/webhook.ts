import type { NextRequest } from "next/server";

export const SANITY_CACHE_TAGS = {
  pages: "pages",
  posts: "posts",
} as const;

type ParsedSanityWebhook = {
  body: { _type?: unknown } | null;
  isValidSignature: boolean | null;
};

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
