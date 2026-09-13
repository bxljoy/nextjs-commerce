import { SEARCH_PAGE_SIZE, type SearchInput } from "./input.ts";

const SEARCH_RESULT_FIELDS = [
  "id",
  "slug",
  "title",
  "excerpt",
  "publishedAt",
] as const;

export type PostSearchRequest = {
  from: number;
  size: typeof SEARCH_PAGE_SIZE;
  track_total_hits: true;
  _source: typeof SEARCH_RESULT_FIELDS;
  query:
    | { match_all: Record<string, never> }
    | {
        multi_match: {
          query: string;
          type: "best_fields";
          fields: ["title^3", "excerpt^2", "bodyText"];
          operator: "and";
        };
      };
  sort: Array<Record<string, "asc" | "desc">>;
};

export function buildPostSearchRequest(input: SearchInput): PostSearchRequest {
  const request = {
    from: (input.page - 1) * SEARCH_PAGE_SIZE,
    size: SEARCH_PAGE_SIZE,
    track_total_hits: true,
    _source: SEARCH_RESULT_FIELDS,
  } as const;

  if (input.query === "") {
    return {
      ...request,
      query: { match_all: {} },
      sort: [{ publishedAt: "desc" }, { id: "asc" }],
    };
  }

  return {
    ...request,
    query: {
      multi_match: {
        query: input.query,
        type: "best_fields",
        fields: ["title^3", "excerpt^2", "bodyText"],
        operator: "and",
      },
    },
    sort: [{ _score: "desc" }, { id: "asc" }],
  };
}
