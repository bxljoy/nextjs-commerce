import { createClient, type SanityClient } from "@sanity/client";
import type { SearchPostDocument } from "../../lib/search/contracts.ts";
import { projectPost } from "../../lib/search/projection.ts";

const SANITY_API_VERSION = "2024-01-01";

export const searchPostCorpusQuery = `
  *[_type == "post" && defined(slug.current)]{
    _id,
    title,
    "slug": slug.current,
    publishedAt,
    excerpt,
    body,
    _updatedAt
  }
`;

type SanitySourceClient = {
  fetch: (query: string) => Promise<unknown>;
};

export function createSearchSanityClient(
  env: Record<string, string | undefined>,
): SanityClient {
  const projectId = env.SANITY_PROJECT_ID;
  const dataset = env.SANITY_DATASET;

  if (!projectId || !dataset) {
    throw new Error("Sanity read configuration is required for search sync");
  }

  return createClient({
    projectId,
    dataset,
    apiVersion: SANITY_API_VERSION,
    perspective: "published",
    useCdn: false,
  });
}

export async function fetchPublishedPostCorpus(
  client: SanitySourceClient,
): Promise<SearchPostDocument[]> {
  const result = await client.fetch(searchPostCorpusQuery);
  if (!Array.isArray(result)) {
    throw new TypeError("Sanity post corpus result must be an array");
  }

  const documents = result.map(projectPost);
  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const document of documents) {
    if (ids.has(document.id)) {
      throw new Error(`duplicate Sanity ID: ${document.id}`);
    }
    if (slugs.has(document.slug)) {
      throw new Error(`duplicate Sanity slug: ${document.slug}`);
    }
    ids.add(document.id);
    slugs.add(document.slug);
  }

  return documents;
}
