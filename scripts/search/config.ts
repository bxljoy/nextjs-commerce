const SEARCH_LAB_INDEX_ALIAS = "commerce-sanity-posts";
const SEARCH_LAB_INDEX_PATTERN = /^commerce-sanity-posts-v[0-9]{13}$/;
const SEARCH_LAB_URLS = new Set([
  "http://127.0.0.1:9200",
  "http://localhost:9200",
]);

export type SearchLabConfig = {
  elasticsearchUrl: string;
  indexAlias: "commerce-sanity-posts";
};

export function assertSafeLabIndexName(name: string): void {
  if (name !== SEARCH_LAB_INDEX_ALIAS && !SEARCH_LAB_INDEX_PATTERN.test(name)) {
    throw new Error("Elasticsearch index name is outside the local search lab");
  }
}

export function readSearchLabConfig(
  env: Record<string, string | undefined>,
): SearchLabConfig {
  const elasticsearchUrl = env.ELASTICSEARCH_URL;
  const indexAlias = env.ELASTICSEARCH_INDEX_ALIAS;

  if (!elasticsearchUrl || !SEARCH_LAB_URLS.has(elasticsearchUrl)) {
    throw new Error(
      "ELASTICSEARCH_URL must use the loopback-only local search lab endpoint",
    );
  }

  if (indexAlias !== SEARCH_LAB_INDEX_ALIAS) {
    throw new Error(
      "ELASTICSEARCH_INDEX_ALIAS must be the local search lab alias",
    );
  }

  return {
    elasticsearchUrl,
    indexAlias,
  };
}
