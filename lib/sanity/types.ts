import type { PortableTextBlock } from "@portabletext/types";

export type SanityImage = {
  _type: "image";
  asset?: { _ref: string; _type: "reference" };
  alt?: string;
};

export type SanitySeo = {
  title?: string;
  description?: string;
};

/** A Portable Text body may contain text blocks and, later, images. */
export type SanityBody = (PortableTextBlock | SanityImage)[];

type SanityDocumentBase = {
  _id: string;
  title: string;
  slug: string;
  body?: SanityBody;
  seo?: SanitySeo;
  _updatedAt: string;
  _createdAt: string;
};

export type Page = SanityDocumentBase;

export type Post = SanityDocumentBase & {
  publishedAt: string;
  excerpt?: string;
  coverImage?: SanityImage;
};
