import type { SanityBody } from "../sanity/types.ts";
import { toPlainText } from "../sanity/utils.ts";
import type { SearchPostDocument } from "./contracts.ts";

const SANITY_DOCUMENT_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const CANONICAL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANONICAL_ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function assertRequiredString(
  post: Record<string, unknown>,
  field: string,
): string {
  const value = post[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function assertCanonicalDate(value: string, field: string): void {
  if (
    !CANONICAL_ISO_DATE.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${field} must be a valid ISO date`);
  }
}

export function projectPost(post: unknown): SearchPostDocument {
  if (typeof post !== "object" || post === null || Array.isArray(post)) {
    throw new TypeError("post must be an object");
  }

  const source = post as Record<string, unknown>;
  const id = assertRequiredString(source, "_id");
  const title = assertRequiredString(source, "title");
  const slug = assertRequiredString(source, "slug");
  const publishedAt = assertRequiredString(source, "publishedAt");
  const updatedAt = assertRequiredString(source, "_updatedAt");

  if (!SANITY_DOCUMENT_ID.test(id)) {
    throw new TypeError("_id must be a valid Sanity document ID");
  }
  if (!CANONICAL_SLUG.test(slug)) {
    throw new TypeError("slug must be a canonical path segment");
  }
  assertCanonicalDate(publishedAt, "publishedAt");
  assertCanonicalDate(updatedAt, "_updatedAt");

  if (source.excerpt != null && typeof source.excerpt !== "string") {
    throw new TypeError("excerpt must be a string when present");
  }
  if (source.body != null && !Array.isArray(source.body)) {
    throw new TypeError("body must be Portable Text when present");
  }

  return {
    id,
    slug,
    title,
    excerpt: source.excerpt ?? "",
    bodyText: toPlainText((source.body ?? undefined) as SanityBody | undefined),
    publishedAt,
    updatedAt,
  };
}
