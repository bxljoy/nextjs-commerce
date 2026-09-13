import assert from "node:assert/strict";
import test from "node:test";
import { projectPost } from "./projection.ts";

const sourcePost = {
  _id: "post-1",
  title: "Cache boundaries",
  slug: "cache-boundaries",
  excerpt: "A concise summary",
  body: [
    {
      _key: "block-1",
      _type: "block",
      style: "normal",
      markDefs: [],
      children: [
        {
          _key: "span-1",
          _type: "span",
          marks: [],
          text: "Next and Sanity cache different boundaries.",
        },
      ],
    },
  ],
  publishedAt: "2026-09-01T00:00:00.000Z",
  _updatedAt: "2026-09-02T00:00:00.000Z",
  secret: "must not be indexed",
};

test("projects only allowlisted searchable fields", () => {
  assert.deepEqual(projectPost(sourcePost), {
    id: "post-1",
    slug: "cache-boundaries",
    title: "Cache boundaries",
    excerpt: "A concise summary",
    bodyText: "Next and Sanity cache different boundaries.",
    publishedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  });
});

test("normalizes absent optional fields to empty strings", () => {
  const { excerpt: _excerpt, body: _body, ...requiredPost } = sourcePost;

  assert.deepEqual(projectPost(requiredPost), {
    id: "post-1",
    slug: "cache-boundaries",
    title: "Cache boundaries",
    excerpt: "",
    bodyText: "",
    publishedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  });
});

test("rejects non-object source values", () => {
  for (const value of [null, undefined, "post", [], 1]) {
    assert.throws(() => projectPost(value), /post must be an object/);
  }
});

test("rejects missing or invalid required strings", () => {
  const invalidFields = [
    ["_id", ""],
    ["_id", "post/1"],
    ["title", ""],
    ["title", "   "],
    ["slug", ""],
    ["slug", "Cache-Boundaries"],
    ["slug", "cache/boundaries"],
    ["slug", "cache--boundaries"],
  ] as const;

  for (const [field, value] of invalidFields) {
    assert.throws(
      () => projectPost({ ...sourcePost, [field]: value }),
      new RegExp(field),
    );
  }

  const { title: _title, ...missingTitle } = sourcePost;
  assert.throws(() => projectPost(missingTitle), /title/);
});

test("rejects invalid publication and update dates", () => {
  for (const field of ["publishedAt", "_updatedAt"] as const) {
    for (const value of ["not-a-date", "2026-02-30T00:00:00.000Z", ""]) {
      assert.throws(
        () => projectPost({ ...sourcePost, [field]: value }),
        new RegExp(field),
      );
    }
  }
});
