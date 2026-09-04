const pageFields = `
  _id,
  title,
  "slug": slug.current,
  body,
  seo,
  _updatedAt,
  _createdAt
`;

const postFields = `
  _id,
  title,
  "slug": slug.current,
  publishedAt,
  excerpt,
  coverImage,
  body,
  seo,
  _updatedAt,
  _createdAt
`;

export const pageQuery = `*[_type == "page" && slug.current == $slug][0]{${pageFields}}`;

export const pagesQuery = `*[_type == "page" && defined(slug.current)]{${pageFields}}`;

export const postQuery = `*[_type == "post" && slug.current == $slug][0]{${postFields}}`;

// `publishedAt` orders only — it does not gate visibility. Unpublished documents
// are already excluded by the client's `published` perspective.
export const postsQuery = `*[_type == "post" && defined(slug.current)]
  | order(publishedAt desc){${postFields}}`;
