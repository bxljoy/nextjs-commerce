import assert from "node:assert/strict";
import test from "node:test";
import { getShopifyCacheOptions } from "./cache-policy.ts";
import * as requestModule from "./request.ts";

type CreateShopifyRequestInit = (
  input: {
    cache: "force-cache" | "no-store";
    next?: { revalidate: number; tags: string[] };
    headers?: HeadersInit;
    query: string;
    variables?: object;
  },
  accessToken: string,
) => RequestInit & { next?: { revalidate: number; tags: string[] } };

const createShopifyRequestInit = (
  requestModule as unknown as {
    createShopifyRequestInit?: CreateShopifyRequestInit;
  }
).createShopifyRequestInit;

test("builds catalog GraphQL requests without dropping cache identity inputs", () => {
  assert.equal(typeof createShopifyRequestInit, "function");

  const query =
    "query Products($sortKey: ProductSortKeys!) { products(first: 3, sortKey: $sortKey) { nodes { id } } }";
  const priceRequest = createShopifyRequestInit!(
    {
      ...getShopifyCacheOptions("catalog", ["products"]),
      headers: { "x-request-id": "catalog-test" },
      query,
      variables: { sortKey: "PRICE" },
    },
    "public-token",
  );
  const titleRequest = createShopifyRequestInit!(
    {
      ...getShopifyCacheOptions("catalog", ["products"]),
      query,
      variables: { sortKey: "TITLE" },
    },
    "public-token",
  );

  assert.equal(priceRequest.method, "POST");
  assert.equal(priceRequest.cache, "force-cache");
  const headers = new Headers(priceRequest.headers);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(
    headers.get("x-shopify-storefront-access-token"),
    "public-token",
  );
  assert.equal(headers.get("x-request-id"), "catalog-test");
  assert.deepEqual(priceRequest.next, {
    revalidate: 3600,
    tags: ["products"],
  });
  assert.deepEqual(JSON.parse(String(priceRequest.body)), {
    query,
    variables: { sortKey: "PRICE" },
  });
  assert.deepEqual(JSON.parse(String(titleRequest.body)), {
    query,
    variables: { sortKey: "TITLE" },
  });
  assert.notEqual(priceRequest.body, titleRequest.body);
});

test("builds private GraphQL requests as no-store", () => {
  assert.equal(typeof createShopifyRequestInit, "function");

  const request = createShopifyRequestInit!(
    {
      ...getShopifyCacheOptions("private"),
      query: "mutation CartCreate { cartCreate { cart { id } } }",
    },
    "public-token",
  );

  assert.equal(request.method, "POST");
  assert.equal(request.cache, "no-store");
  assert.equal(request.next, undefined);
  assert.deepEqual(JSON.parse(String(request.body)), {
    query: "mutation CartCreate { cartCreate { cart { id } } }",
  });
});
