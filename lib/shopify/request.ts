import type { ShopifyCacheOptions } from "./cache-policy";

type ShopifyRequestOptions = ShopifyCacheOptions & {
  headers?: HeadersInit;
  query: string;
  variables?: object;
};

export type ShopifyRequestInit = RequestInit & {
  next?: ShopifyCacheOptions["next"];
};

export function createShopifyRequestInit(
  { cache, headers, next, query, variables }: ShopifyRequestOptions,
  accessToken: string,
): ShopifyRequestInit {
  const requestHeaders = new Headers({
    "Content-Type": "application/json",
    "X-Shopify-Storefront-Access-Token": accessToken,
  });

  new Headers(headers).forEach((value, name) => {
    requestHeaders.set(name, value);
  });

  return {
    method: "POST",
    cache,
    next,
    headers: requestHeaders,
    body: JSON.stringify({
      ...(query && { query }),
      ...(variables && { variables }),
    }),
  };
}
