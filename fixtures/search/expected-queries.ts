import type { SearchPostDocument } from "../../lib/search/contracts.ts";

export type ExpectedQueryCase = {
  name:
    | "title boost"
    | "excerpt boost"
    | "body-only match"
    | "English stemming"
    | "two-term and"
    | "no match"
    | "empty-query date ordering";
  query: string;
  expectedTotal: number;
  expectedIncludedIds: readonly string[];
  expectedExcludedIds: readonly string[];
  relativeOrder: readonly (readonly [beforeId: string, afterId: string])[];
};

function document(
  idSuffix: string,
  day: number,
  fields: Partial<
    Pick<SearchPostDocument, "title" | "excerpt" | "bodyText">
  > = {},
): SearchPostDocument {
  const date = `2026-01-${String(day).padStart(2, "0")}T12:00:00.000Z`;
  return {
    id: `integration.post.${idSuffix}`,
    slug: `integration-search-${idSuffix}`,
    title:
      fields.title ?? `Controlled document ${String(day).padStart(2, "0")}`,
    excerpt:
      fields.excerpt ?? "A neutral synthetic search integration example.",
    bodyText:
      fields.bodyText ??
      "This controlled local fixture keeps the searchable wording neutral.",
    publishedAt: date,
    updatedAt: date,
  };
}

export const SEARCH_INTEGRATION_DOCUMENTS = [
  document("title", 1, { title: "Luminous Quasar" }),
  document("excerpt", 2, { excerpt: "Luminous quasar" }),
  document("body", 3, { bodyText: "Luminous quasar" }),
  document("body-only", 4, { bodyText: "Cerulean nebula" }),
  document("stemming", 5, { bodyText: "A careful explorer runs swiftly." }),
  document("and-complete", 6, { excerpt: "Amber compass" }),
  document("amber-only", 7, { bodyText: "Amber marker" }),
  document("compass-only", 8, { bodyText: "Compass marker" }),
  document("page-nine", 9),
  document("page-ten", 10),
  document("page-eleven", 11),
  document("page-twelve", 12),
  document("page-thirteen", 13),
  document("page-fourteen", 14),
] as const satisfies readonly SearchPostDocument[];

const EMPTY_QUERY_PAGE_ONE_IDS = [
  "integration.post.page-fourteen",
  "integration.post.page-thirteen",
  "integration.post.page-twelve",
  "integration.post.page-eleven",
  "integration.post.page-ten",
  "integration.post.page-nine",
  "integration.post.compass-only",
  "integration.post.amber-only",
  "integration.post.and-complete",
  "integration.post.stemming",
] as const;

export const EXPECTED_QUERY_CASES = [
  {
    name: "title boost",
    query: "luminous quasar",
    expectedTotal: 3,
    expectedIncludedIds: [
      "integration.post.title",
      "integration.post.excerpt",
      "integration.post.body",
    ],
    expectedExcludedIds: ["integration.post.body-only"],
    relativeOrder: [
      ["integration.post.title", "integration.post.excerpt"],
      ["integration.post.title", "integration.post.body"],
    ],
  },
  {
    name: "excerpt boost",
    query: "luminous quasar",
    expectedTotal: 3,
    expectedIncludedIds: ["integration.post.excerpt", "integration.post.body"],
    expectedExcludedIds: ["integration.post.body-only"],
    relativeOrder: [["integration.post.excerpt", "integration.post.body"]],
  },
  {
    name: "body-only match",
    query: "cerulean nebula",
    expectedTotal: 1,
    expectedIncludedIds: ["integration.post.body-only"],
    expectedExcludedIds: ["integration.post.title", "integration.post.excerpt"],
    relativeOrder: [],
  },
  {
    name: "English stemming",
    query: "running",
    expectedTotal: 1,
    expectedIncludedIds: ["integration.post.stemming"],
    expectedExcludedIds: ["integration.post.body-only"],
    relativeOrder: [],
  },
  {
    name: "two-term and",
    query: "amber compass",
    expectedTotal: 1,
    expectedIncludedIds: ["integration.post.and-complete"],
    expectedExcludedIds: [
      "integration.post.amber-only",
      "integration.post.compass-only",
    ],
    relativeOrder: [],
  },
  {
    name: "no match",
    query: "xylophonic zeppelin",
    expectedTotal: 0,
    expectedIncludedIds: [],
    expectedExcludedIds: [
      "integration.post.title",
      "integration.post.body-only",
    ],
    relativeOrder: [],
  },
  {
    name: "empty-query date ordering",
    query: "",
    expectedTotal: SEARCH_INTEGRATION_DOCUMENTS.length,
    expectedIncludedIds: EMPTY_QUERY_PAGE_ONE_IDS,
    expectedExcludedIds: ["integration.post.body-only"],
    relativeOrder: EMPTY_QUERY_PAGE_ONE_IDS.slice(0, -1).map((id, index) => [
      id,
      EMPTY_QUERY_PAGE_ONE_IDS[index + 1]!,
    ]),
  },
] as const satisfies readonly ExpectedQueryCase[];
