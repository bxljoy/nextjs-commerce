export const SEARCH_PAGE_SIZE = 10;
export const SEARCH_MAX_PAGE = 100;
const SEARCH_MAX_QUERY_LENGTH = 200;

export type SearchInput = {
  query: string;
  page: number;
};

export type ParsedSearchInput =
  | { ok: true; value: SearchInput }
  | { ok: false; message: string };

type SearchParams = {
  q?: string | string[];
  page?: string | string[];
};

export function parseSearchInput(
  searchParams: SearchParams,
): ParsedSearchInput {
  if (Array.isArray(searchParams.q) || Array.isArray(searchParams.page)) {
    return {
      ok: false,
      message: "Search parameters must not be repeated.",
    };
  }

  const query = (searchParams.q ?? "").trim();
  if (query.length > SEARCH_MAX_QUERY_LENGTH) {
    return {
      ok: false,
      message: "Query must be 200 characters or fewer.",
    };
  }

  const rawPage = searchParams.page;
  if (rawPage === undefined) {
    return { ok: true, value: { query, page: 1 } };
  }

  if (!/^[1-9]\d*$/.test(rawPage)) {
    return {
      ok: false,
      message: "Page must be an integer from 1 to 100.",
    };
  }

  const page = Number(rawPage);
  if (page > SEARCH_MAX_PAGE) {
    return {
      ok: false,
      message: "Page must be an integer from 1 to 100.",
    };
  }

  return { ok: true, value: { query, page } };
}
