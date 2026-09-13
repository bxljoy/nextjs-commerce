import { createHash } from "node:crypto";
import type {
  SanitySeedBlock,
  SanitySeedPost,
  SanitySeedSpan,
} from "../../fixtures/search/posts.ts";

export type SeedPlan = {
  create: SanitySeedPost[];
  skipIdentical: string[];
  conflicts: { id: string; reason: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSpan(value: unknown): SanitySeedSpan {
  if (
    !isRecord(value) ||
    typeof value._key !== "string" ||
    value._type !== "span" ||
    !Array.isArray(value.marks) ||
    !value.marks.every((mark) => typeof mark === "string") ||
    typeof value.text !== "string"
  ) {
    throw new TypeError("owned post contains malformed Portable Text span");
  }

  return {
    _key: value._key,
    _type: "span",
    marks: [...value.marks],
    text: value.text,
  };
}

function readBlock(value: unknown): SanitySeedBlock {
  if (
    !isRecord(value) ||
    typeof value._key !== "string" ||
    value._type !== "block" ||
    value.style !== "normal" ||
    !Array.isArray(value.markDefs) ||
    value.markDefs.length !== 0 ||
    !Array.isArray(value.children) ||
    value.children.length !== 1
  ) {
    throw new TypeError("owned post contains malformed Portable Text block");
  }

  return {
    _key: value._key,
    _type: "block",
    style: "normal",
    markDefs: [],
    children: [readSpan(value.children[0])],
  };
}

function ownedPostFields(value: unknown): SanitySeedPost {
  if (
    !isRecord(value) ||
    typeof value._id !== "string" ||
    value._type !== "post" ||
    typeof value.title !== "string" ||
    !isRecord(value.slug) ||
    value.slug._type !== "slug" ||
    typeof value.slug.current !== "string" ||
    typeof value.publishedAt !== "string" ||
    typeof value.excerpt !== "string" ||
    !Array.isArray(value.body) ||
    !isRecord(value.seo) ||
    typeof value.seo.title !== "string" ||
    typeof value.seo.description !== "string"
  ) {
    throw new TypeError("owned post is malformed");
  }

  return {
    _id: value._id,
    _type: "post",
    title: value.title,
    slug: { _type: "slug", current: value.slug.current },
    publishedAt: value.publishedAt,
    excerpt: value.excerpt,
    body: value.body.map(readBlock),
    seo: {
      title: value.seo.title,
      description: value.seo.description,
    },
  };
}

export function digestOwnedPost(post: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(ownedPostFields(post)))
    .digest("hex");
}

export function planSeed(
  expected: readonly SanitySeedPost[],
  existing: readonly unknown[],
): SeedPlan {
  const expectedById = new Map<string, SanitySeedPost>();
  const expectedBySlug = new Map<string, SanitySeedPost>();
  for (const post of expected) {
    const validated = ownedPostFields(post);
    if (expectedById.has(validated._id)) {
      throw new Error(`duplicate proposed ID: ${validated._id}`);
    }
    if (expectedBySlug.has(validated.slug.current)) {
      throw new Error(`duplicate proposed slug: ${validated.slug.current}`);
    }
    expectedById.set(validated._id, post);
    expectedBySlug.set(validated.slug.current, post);
  }

  const accountedFor = new Set<string>();
  const skipIdentical: string[] = [];
  const conflicts: { id: string; reason: string }[] = [];

  for (const [index, candidate] of existing.entries()) {
    const rawId =
      isRecord(candidate) && typeof candidate._id === "string"
        ? candidate._id
        : `<malformed-${index + 1}>`;
    const draftId = rawId.startsWith("drafts.")
      ? rawId.slice("drafts.".length)
      : undefined;
    if (draftId && expectedById.has(draftId)) {
      conflicts.push({ id: draftId, reason: "draft pair exists" });
      continue;
    }

    let actual: SanitySeedPost;
    try {
      actual = ownedPostFields(candidate);
    } catch {
      conflicts.push({ id: rawId, reason: "existing document is malformed" });
      continue;
    }

    const expectedWithId = expectedById.get(actual._id);
    const expectedWithSlug = expectedBySlug.get(actual.slug.current);
    if (!expectedWithId && !expectedWithSlug) continue;

    if (!expectedWithId && expectedWithSlug) {
      conflicts.push({
        id: actual._id,
        reason: `slug collides with ${expectedWithSlug._id}`,
      });
      continue;
    }

    if (!expectedWithId) continue;
    accountedFor.add(expectedWithId._id);

    if (expectedWithSlug?._id !== expectedWithId._id) {
      conflicts.push({
        id: actual._id,
        reason: "proposed ID uses a conflicting slug",
      });
      continue;
    }

    if (digestOwnedPost(expectedWithId) !== digestOwnedPost(actual)) {
      conflicts.push({
        id: actual._id,
        reason: "owned content differs for proposed ID",
      });
      continue;
    }

    skipIdentical.push(actual._id);
  }

  const uniqueConflicts = conflicts.filter(
    (conflict, index) =>
      conflicts.findIndex(
        (candidate) =>
          candidate.id === conflict.id && candidate.reason === conflict.reason,
      ) === index,
  );

  return {
    create:
      uniqueConflicts.length > 0
        ? []
        : expected.filter((post) => !accountedFor.has(post._id)),
    skipIdentical,
    conflicts: uniqueConflicts,
  };
}
