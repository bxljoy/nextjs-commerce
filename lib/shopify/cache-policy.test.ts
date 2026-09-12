import assert from "node:assert/strict";
import test from "node:test";
import * as cachePolicyModule from "./cache-policy.ts";

type ShopifyCacheOptions =
  | { cache: "no-store" }
  | {
      cache: "force-cache";
      next: { revalidate: number; tags: string[] };
    };

type GetShopifyCacheOptions = (
  scope: "catalog" | "private",
  tags?: string[],
) => ShopifyCacheOptions;

const getShopifyCacheOptions = (
  cachePolicyModule as unknown as {
    getShopifyCacheOptions?: GetShopifyCacheOptions;
  }
).getShopifyCacheOptions;

test("catalog requests use a finite tagged Data Cache policy", () => {
  assert.equal(typeof getShopifyCacheOptions, "function");

  assert.deepEqual(getShopifyCacheOptions!("catalog", ["products"]), {
    cache: "force-cache",
    next: { revalidate: 3600, tags: ["products"] },
  });
});

test("private and mutation requests bypass the shared Data Cache", () => {
  assert.equal(typeof getShopifyCacheOptions, "function");

  assert.deepEqual(getShopifyCacheOptions!("private"), {
    cache: "no-store",
  });
});
