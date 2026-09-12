import assert from "node:assert/strict";
import { encodeSignatureHeader, SIGNATURE_HEADER_NAME } from "@sanity/webhook";
import test from "node:test";
import {
  handleSanityWebhook,
  SANITY_CACHE_TAGS,
  type SanityWebhookDependencies,
} from "./webhook.ts";
import * as webhookModule from "./webhook.ts";

const request = new Request("https://example.com/api/revalidate/sanity", {
  method: "POST",
}) as SanityWebhookDependencies["request"];

type ParseSanityWebhook = (
  request: SanityWebhookDependencies["request"],
  secret: string,
  waitForContentLakeEventualConsistency?: boolean,
) => Promise<{
  body: { _type?: unknown } | null;
  isValidSignature: boolean | null;
}>;

const parseSanityWebhook = (
  webhookModule as unknown as {
    parseSanityWebhook?: ParseSanityWebhook;
  }
).parseSanityWebhook;

function dependencies(
  overrides: Partial<Omit<SanityWebhookDependencies, "request">> = {},
) {
  const invalidatedTags: string[] = [];
  const errors: string[] = [];

  return {
    invalidatedTags,
    errors,
    options: {
      secret: "test-secret",
      parseBody: async () => ({
        body: { _type: "page" },
        isValidSignature: true,
      }),
      revalidateTag: (tag: string) => invalidatedTags.push(tag),
      reportError: (message: string) => errors.push(message),
      ...overrides,
    },
  };
}

test("parses an authentic signature against the unmodified request body", async () => {
  assert.equal(typeof parseSanityWebhook, "function");

  const secret = "signed-payload-test-secret";
  const body = ' {"_type":"page"}\n';
  const signature = await encodeSignatureHeader(body, Date.now(), secret);
  const signedRequest = new Request(
    "https://example.com/api/revalidate/sanity",
    {
      method: "POST",
      body,
      headers: { [SIGNATURE_HEADER_NAME]: signature },
    },
  ) as SanityWebhookDependencies["request"];

  const parsed = await parseSanityWebhook!(signedRequest, secret, false);

  assert.deepEqual(parsed, {
    body: { _type: "page" },
    isValidSignature: true,
  });
});

test("rejects an invalid real signature before parsing its payload", async () => {
  assert.equal(typeof parseSanityWebhook, "function");

  const signedRequest = new Request(
    "https://example.com/api/revalidate/sanity",
    {
      method: "POST",
      body: "not-json",
      headers: { [SIGNATURE_HEADER_NAME]: "invalid-signature" },
    },
  ) as SanityWebhookDependencies["request"];

  const parsed = await parseSanityWebhook!(
    signedRequest,
    "signed-payload-test-secret",
    false,
  );

  assert.deepEqual(parsed, { body: null, isValidSignature: false });
});

test("fails closed when the server secret is missing", async () => {
  let parseCalled = false;
  const { options, invalidatedTags } = dependencies({
    secret: undefined,
    parseBody: async () => {
      parseCalled = true;
      return { body: { _type: "page" }, isValidSignature: true };
    },
  });

  const response = await handleSanityWebhook({ request, ...options });

  assert.equal(response.status, 500);
  assert.equal(parseCalled, false);
  assert.deepEqual(invalidatedTags, []);
});

test("rejects an invalid signature without invalidating data", async () => {
  const { options, invalidatedTags } = dependencies({
    parseBody: async () => ({
      body: { _type: "page" },
      isValidSignature: false,
    }),
  });

  const response = await handleSanityWebhook({ request, ...options });

  assert.equal(response.status, 401);
  assert.deepEqual(invalidatedTags, []);
});

test("rejects a missing signature without invalidating data", async () => {
  const { options, invalidatedTags } = dependencies({
    parseBody: async () => ({
      body: null,
      isValidSignature: null,
    }),
  });

  const response = await handleSanityWebhook({ request, ...options });

  assert.equal(response.status, 401);
  assert.deepEqual(invalidatedTags, []);
});

test("rejects malformed input without exposing parser errors", async () => {
  const { options, invalidatedTags } = dependencies({
    parseBody: async () => {
      throw new SyntaxError("payload details must stay private");
    },
  });

  const response = await handleSanityWebhook({ request, ...options });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, { error: "Invalid webhook payload" });
  assert.deepEqual(invalidatedTags, []);
});

test("rejects unsupported document types", async () => {
  const { options, invalidatedTags } = dependencies({
    parseBody: async () => ({
      body: { _type: "author" },
      isValidSignature: true,
    }),
  });

  const response = await handleSanityWebhook({ request, ...options });

  assert.equal(response.status, 400);
  assert.deepEqual(invalidatedTags, []);
});

test("invalidates the page cache for a signed page event", async () => {
  const { options, invalidatedTags } = dependencies();

  const response = await handleSanityWebhook({ request, ...options });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(invalidatedTags, [SANITY_CACHE_TAGS.pages]);
  assert.deepEqual(body, {
    revalidated: true,
    tags: [SANITY_CACHE_TAGS.pages],
  });
});

test("invalidates the post cache for a signed post event", async () => {
  const { options, invalidatedTags } = dependencies({
    parseBody: async () => ({
      body: { _type: "post" },
      isValidSignature: true,
    }),
  });

  const response = await handleSanityWebhook({ request, ...options });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(invalidatedTags, [SANITY_CACHE_TAGS.posts]);
  assert.deepEqual(body, {
    revalidated: true,
    tags: [SANITY_CACHE_TAGS.posts],
  });
});
