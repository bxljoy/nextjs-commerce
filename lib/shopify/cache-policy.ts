export const SHOPIFY_REVALIDATE_SECONDS = 3600;

export type ShopifyCacheOptions = {
  cache: "force-cache" | "no-store";
  next?: {
    revalidate: number;
    tags: string[];
  };
};

/**
 * Catalog reads are shared and tagged; cart reads and all mutations are not.
 *
 * Source: https://nextjs.org/docs/15/app/api-reference/functions/fetch
 */
export function getShopifyCacheOptions(
  scope: "catalog" | "private",
  tags: string[] = [],
): ShopifyCacheOptions {
  if (scope === "private") {
    return { cache: "no-store" };
  }

  return {
    cache: "force-cache",
    next: {
      revalidate: SHOPIFY_REVALIDATE_SECONDS,
      tags,
    },
  };
}
