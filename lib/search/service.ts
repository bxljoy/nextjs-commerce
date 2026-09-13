import type { SearchHit, SearchPage } from "./contracts.ts";
import { requestElasticsearch } from "./elasticsearch.ts";
import { SEARCH_PAGE_SIZE, type SearchInput } from "./input.ts";
import { buildPostSearchRequest } from "./query.ts";

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type SearchDependencies = {
  baseUrl: string;
  alias: string;
  fetch: Fetch;
};

type ElasticsearchHit = {
  _score: number | null;
  _source: Omit<SearchHit, "score">;
};

type ElasticsearchSearchResponse = {
  hits: {
    total: { value: number; relation: "eq" };
    hits: ElasticsearchHit[];
  };
};

const SANITY_DOCUMENT_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const CANONICAL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANONICAL_ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CANONICAL_ISO_DATE.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isSearchSource(value: unknown): value is Omit<SearchHit, "score"> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    SANITY_DOCUMENT_ID.test(value.id) &&
    typeof value.slug === "string" &&
    CANONICAL_SLUG.test(value.slug) &&
    typeof value.title === "string" &&
    value.title.trim() !== "" &&
    typeof value.excerpt === "string" &&
    isCanonicalDate(value.publishedAt)
  );
}

function isSearchHit(value: unknown): value is ElasticsearchHit {
  if (!isRecord(value)) {
    return false;
  }

  const score = value._score;
  return (
    (score === null || (typeof score === "number" && Number.isFinite(score))) &&
    isSearchSource(value._source)
  );
}

function isSearchResponse(
  value: unknown,
): value is ElasticsearchSearchResponse {
  if (!isRecord(value) || !isRecord(value.hits)) {
    return false;
  }

  const total = value.hits.total;
  const hits = value.hits.hits;
  return (
    isRecord(total) &&
    total.relation === "eq" &&
    typeof total.value === "number" &&
    Number.isSafeInteger(total.value) &&
    total.value >= 0 &&
    Array.isArray(hits) &&
    hits.length <= SEARCH_PAGE_SIZE &&
    hits.every(isSearchHit)
  );
}

export async function searchPosts(
  input: SearchInput,
  dependencies: SearchDependencies,
): Promise<SearchPage> {
  const response = await requestElasticsearch({
    baseUrl: dependencies.baseUrl,
    path: `/${encodeURIComponent(dependencies.alias)}/_search`,
    method: "POST",
    body: buildPostSearchRequest(input),
    fetch: dependencies.fetch,
    isResponse: isSearchResponse,
  });

  return {
    results: response.hits.hits.map((hit) => ({
      id: hit._source.id,
      slug: hit._source.slug,
      title: hit._source.title,
      excerpt: hit._source.excerpt,
      publishedAt: hit._source.publishedAt,
      score: hit._score,
    })),
    total: response.hits.total.value,
    page: input.page,
    pageSize: SEARCH_PAGE_SIZE,
  };
}
