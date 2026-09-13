export const POST_INDEX_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
  },
  mappings: {
    dynamic: "strict",
    properties: {
      id: { type: "keyword" },
      slug: { type: "keyword" },
      title: { type: "text", analyzer: "english" },
      excerpt: { type: "text", analyzer: "english" },
      bodyText: { type: "text", analyzer: "english" },
      publishedAt: { type: "date" },
      updatedAt: { type: "date" },
    },
  },
} as const;
