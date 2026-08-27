export type SortFilterItem = {
  title: string;
  slug: string | null;
  sortKey: "RELEVANCE" | "BEST_SELLING" | "CREATED_AT" | "PRICE";
  reverse: boolean;
};

export const defaultSort: SortFilterItem = {
  title: "Relevance",
  slug: null,
  sortKey: "RELEVANCE",
  reverse: false,
};

export const sorting: SortFilterItem[] = [
  defaultSort,
  {
    title: "Trending",
    slug: "trending-desc",
    sortKey: "BEST_SELLING",
    reverse: false,
  }, // asc
  {
    title: "Latest arrivals",
    slug: "latest-desc",
    sortKey: "CREATED_AT",
    reverse: true,
  },
  {
    title: "Price: Low to high",
    slug: "price-asc",
    sortKey: "PRICE",
    reverse: false,
  }, // asc
  {
    title: "Price: High to low",
    slug: "price-desc",
    sortKey: "PRICE",
    reverse: true,
  },
];

export const TAGS = {
  collections: "collections",
  products: "products",
  cart: "cart",
};

export const HIDDEN_PRODUCT_TAG = "nextjs-frontend-hidden";
export const DEFAULT_OPTION = "Default Title";
// Pin the Storefront API version explicitly: Shopify silently "falls forward"
// to the oldest supported version if this one is out of support, so an
// unpinned/stale value means you don't know which schema you're talking to.
// Override per-environment with SHOPIFY_API_VERSION (server-only - this module
// is also imported by client components, where the env ref inlines to
// undefined and the default below applies).
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
export const SHOPIFY_GRAPHQL_API_ENDPOINT = `/api/${SHOPIFY_API_VERSION}/graphql.json`;
