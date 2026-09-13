import type { SanityBody } from "../sanity/types.ts";

export type SanityPostSource = {
  _id: string;
  title: string;
  slug: string;
  publishedAt: string;
  excerpt?: string | null;
  body?: SanityBody | null;
  _updatedAt: string;
};

export type SearchPostDocument = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyText: string;
  publishedAt: string;
  updatedAt: string;
};

export type SearchHit = Pick<
  SearchPostDocument,
  "id" | "slug" | "title" | "excerpt" | "publishedAt"
> & { score: number | null };

export type SearchPage = {
  results: SearchHit[];
  total: number;
  page: number;
  pageSize: 10;
};
