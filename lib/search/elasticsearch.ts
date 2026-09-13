const SEARCH_REQUEST_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const OPTIONAL_ACCEPTED_STATUSES = new Set([404]);
const UNAVAILABLE_MESSAGE = "Search is temporarily unavailable.";

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type ElasticsearchRequest<T> = {
  baseUrl: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  acceptedStatuses?: readonly number[];
  fetch: Fetch;
  isResponse: (value: unknown) => value is T;
};

export class SearchUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "SearchUnavailableError";
  }
}

function buildRequestUrl(baseUrl: string, path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new SearchUnavailableError();
  }

  try {
    const base = new URL(baseUrl);
    const url = new URL(path, base);
    if (url.origin !== base.origin) {
      throw new SearchUnavailableError();
    }
    return url;
  } catch (error) {
    if (error instanceof SearchUnavailableError) {
      throw error;
    }
    throw new SearchUnavailableError();
  }
}

function acceptsStatus(
  status: number,
  acceptedStatuses: readonly number[] | undefined,
): boolean {
  if (status >= 200 && status < 300) {
    return true;
  }

  if (
    acceptedStatuses?.some(
      (acceptedStatus) => !OPTIONAL_ACCEPTED_STATUSES.has(acceptedStatus),
    )
  ) {
    throw new SearchUnavailableError();
  }

  return acceptedStatuses?.includes(status) ?? false;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (response.body === null) {
    throw new SearchUnavailableError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bytesRead += value.byteLength;
    if (bytesRead > MAX_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The bounded read has already failed closed.
      }
      throw new SearchUnavailableError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SearchUnavailableError();
  }
}

export async function requestElasticsearch<T>(
  request: ElasticsearchRequest<T>,
): Promise<T> {
  try {
    const url = buildRequestUrl(request.baseUrl, request.path);
    const response = await request.fetch(url, {
      method: request.method,
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
    });

    if (!acceptsStatus(response.status, request.acceptedStatuses)) {
      throw new SearchUnavailableError();
    }

    const value = await readBoundedJson(response);
    if (!request.isResponse(value)) {
      throw new SearchUnavailableError();
    }
    return value;
  } catch (error) {
    if (error instanceof SearchUnavailableError) {
      throw error;
    }
    throw new SearchUnavailableError();
  }
}
