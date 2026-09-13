import assert from "node:assert/strict";
import test from "node:test";
import {
  requestElasticsearch,
  SearchUnavailableError,
} from "./elasticsearch.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(
  value: unknown,
  init: { status?: number } = {},
): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

test("search requests use the configured origin and explicit no-cache JSON options", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  let capturedTimeout: number | undefined;
  const originalTimeout = AbortSignal.timeout;

  AbortSignal.timeout = (milliseconds: number) => {
    capturedTimeout = milliseconds;
    return originalTimeout(60_000);
  };

  try {
    await requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "/commerce-sanity-posts/_search",
      method: "POST",
      body: { query: { match_all: {} } },
      fetch: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return jsonResponse({ acknowledged: true });
      },
      isResponse: isRecord,
    });
  } finally {
    AbortSignal.timeout = originalTimeout;
  }

  assert.equal(
    capturedUrl,
    "http://127.0.0.1:9200/commerce-sanity-posts/_search",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.cache, "no-store");
  assert.deepEqual(capturedInit?.headers, {
    "content-type": "application/json",
  });
  assert.equal(
    capturedInit?.body,
    JSON.stringify({ query: { match_all: {} } }),
  );
  assert.ok(capturedInit?.signal instanceof AbortSignal);
  assert.equal(capturedTimeout, 3_000);
});

test("rejects paths that could escape the configured Elasticsearch origin", async () => {
  let fetchCalls = 0;
  const fetch = async () => {
    fetchCalls += 1;
    return jsonResponse({});
  };

  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "//search.example.com/_search",
      method: "GET",
      fetch,
      isResponse: isRecord,
    }),
    SearchUnavailableError,
  );
  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "http://search.example.com/_search",
      method: "GET",
      fetch,
      isResponse: isRecord,
    }),
    SearchUnavailableError,
  );
  assert.equal(fetchCalls, 0);
});

test("accepts only explicitly allowed non-success statuses", async () => {
  const accepted = await requestElasticsearch({
    baseUrl: "http://127.0.0.1:9200",
    path: "/_alias/commerce-sanity-posts",
    method: "GET",
    acceptedStatuses: [404],
    fetch: async () =>
      jsonResponse({ error: "alias missing" }, { status: 404 }),
    isResponse: isRecord,
  });

  assert.deepEqual(accepted, { error: "alias missing" });

  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "/_alias/commerce-sanity-posts",
      method: "GET",
      fetch: async () =>
        jsonResponse({ error: "alias missing" }, { status: 404 }),
      isResponse: isRecord,
    }),
    SearchUnavailableError,
  );

  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "/_alias/commerce-sanity-posts",
      method: "GET",
      acceptedStatuses: [503],
      fetch: async () =>
        jsonResponse({ error: "node unavailable" }, { status: 503 }),
      isResponse: isRecord,
    }),
    SearchUnavailableError,
  );
});

test("rejects other non-success responses without exposing their bodies", async () => {
  const secretBody = "internal-node-detail";

  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "/commerce-sanity-posts/_search",
      method: "POST",
      body: {},
      fetch: async () => jsonResponse({ error: secretBody }, { status: 503 }),
      isResponse: isRecord,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SearchUnavailableError);
      assert.doesNotMatch(error.message, new RegExp(secretBody));
      return true;
    },
  );
});

test("rejects invalid JSON with a generic unavailable error", async () => {
  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "/commerce-sanity-posts/_search",
      method: "POST",
      body: {},
      fetch: async () => new Response("private invalid json", { status: 200 }),
      isResponse: isRecord,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SearchUnavailableError);
      assert.doesNotMatch(error.message, /private invalid json/);
      return true;
    },
  );
});

test("cancels an oversized streamed response as soon as it exceeds one MiB", async () => {
  let cancelled = false;
  let pulls = 0;
  const chunk = new Uint8Array(600 * 1024).fill(32);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "/commerce-sanity-posts/_search",
      method: "POST",
      body: {},
      fetch: async () => new Response(body, { status: 200 }),
      isResponse: isRecord,
    }),
    SearchUnavailableError,
  );
  assert.equal(cancelled, true);
  assert.ok(pulls >= 2 && pulls <= 3);
});

test("rejects unexpected JSON response shapes", async () => {
  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "/commerce-sanity-posts/_search",
      method: "POST",
      body: {},
      fetch: async () => jsonResponse(["not", "an", "object"]),
      isResponse: isRecord,
    }),
    SearchUnavailableError,
  );
});

test("converts fetch failures to generic unavailable errors", async () => {
  await assert.rejects(
    requestElasticsearch({
      baseUrl: "http://127.0.0.1:9200",
      path: "/commerce-sanity-posts/_search",
      method: "POST",
      body: {},
      fetch: async () => {
        throw new Error("private connection detail");
      },
      isResponse: isRecord,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SearchUnavailableError);
      assert.doesNotMatch(error.message, /private connection detail/);
      return true;
    },
  );
});
