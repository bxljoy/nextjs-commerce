import "server-only";

import { readSearchLabConfig } from "../../scripts/search/config.ts";
import type { SearchPage } from "./contracts.ts";
import { SearchUnavailableError } from "./elasticsearch.ts";
import type { SearchInput } from "./input.ts";
import { searchPosts } from "./service.ts";

export async function searchPublishedPosts(
  input: SearchInput,
): Promise<SearchPage> {
  try {
    const config = readSearchLabConfig(process.env);
    return await searchPosts(input, {
      baseUrl: config.elasticsearchUrl,
      alias: config.indexAlias,
      fetch,
    });
  } catch (error) {
    if (error instanceof SearchUnavailableError) {
      throw error;
    }
    throw new SearchUnavailableError();
  }
}
