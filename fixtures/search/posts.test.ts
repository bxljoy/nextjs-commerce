import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchLabPosts } from "./posts.ts";

const EXISTING_POST_TITLES = new Set([
  "Everything is Great",
  "I am a Senior Software Engineer",
  "I am familiar with NextJS",
  "I need more Good Luck",
  "This is the new start",
]);

const TOPIC_SLUGS = [
  "cache-architecture",
  "content-modeling",
  "search-relevance",
  "accessibility",
  "testing",
  "observability",
  "performance",
  "security",
  "deployment",
  "api-design",
];

const ANGLE_SLUGS = [
  "foundations",
  "trade-offs",
  "workflow",
  "failure-modes",
  "measurement",
  "review",
  "migration",
  "debugging",
  "examples",
  "checklist",
];

test("builds the exact deterministic 10-topic by 10-angle fixture matrix", () => {
  const first = buildSearchLabPosts();
  const second = buildSearchLabPosts();

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.deepEqual(
    first.map((post) => post._id),
    Array.from(
      { length: 100 },
      (_, index) => `search-lab-post-${String(index + 1).padStart(3, "0")}`,
    ),
  );

  const slugs = first.map((post) => post.slug.current);
  assert.equal(new Set(slugs).size, 100);
  for (const topic of TOPIC_SLUGS) {
    for (const angle of ANGLE_SLUGS) {
      assert.ok(slugs.includes(`search-lab-${topic}-${angle}`));
    }
  }
});

test("produces schema-compatible visibly labeled posts", () => {
  const posts = buildSearchLabPosts();

  for (const [index, post] of posts.entries()) {
    assert.equal(post._type, "post");
    assert.match(
      post.title,
      new RegExp(
        `^\\[Search Lab Sample ${String(index + 1).padStart(3, "0")}\\] `,
      ),
    );
    assert.equal(post.slug._type, "slug");
    assert.ok(post.slug.current.startsWith("search-lab-"));
    assert.ok(post.slug.current.length <= 96);
    assert.ok(Number.isFinite(Date.parse(post.publishedAt)));
    assert.ok(post.excerpt.length <= 300);
    assert.ok(post.body.length >= 3);

    for (const block of post.body) {
      assert.equal(block._type, "block");
      assert.match(block._key, /^paragraph-[1-9][0-9]*$/);
      assert.equal(block.style, "normal");
      assert.deepEqual(block.markDefs, []);
      assert.equal(block.children.length, 1);
      assert.equal(block.children[0]?._type, "span");
      assert.match(block.children[0]?._key ?? "", /^span-[1-9][0-9]*$/);
      assert.deepEqual(block.children[0]?.marks, []);
      assert.ok((block.children[0]?.text.length ?? 0) > 0);
    }
  }
});

test("uses safe original sample text rather than personal or baseline content", () => {
  const posts = buildSearchLabPosts();
  const text = posts
    .flatMap((post) => [
      post.title,
      post.excerpt,
      post.seo.title,
      post.seo.description,
      ...post.body.flatMap((block) =>
        block.children.map((child) => child.text),
      ),
    ])
    .join(" ");

  assert.doesNotMatch(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(text, /(?:\+?\d[\d ()-]{7,}\d)/);
  assert.doesNotMatch(
    text,
    /\b(?:Alice|Bob|Carol|David|Emma|John|Maria|Michael|Sarah|William)\b/i,
  );
  for (const post of posts) {
    assert.equal(EXISTING_POST_TITLES.has(post.title), false);
  }
});

test("includes controlled relevance terms in title and body positions", () => {
  const posts = buildSearchLabPosts();
  const byId = new Map(posts.map((post) => [post._id, post]));
  const bodyText = (id: string) =>
    byId
      .get(id)
      ?.body.flatMap((block) => block.children.map((child) => child.text))
      .join(" ") ?? "";

  assert.match(
    byId.get("search-lab-post-001")?.title ?? "",
    /distributed cache/i,
  );
  assert.doesNotMatch(
    byId.get("search-lab-post-002")?.title ?? "",
    /distributed cache/i,
  );
  assert.match(bodyText("search-lab-post-002"), /distributed cache/i);

  assert.match(byId.get("search-lab-post-021")?.title ?? "", /content search/i);
  assert.doesNotMatch(
    byId.get("search-lab-post-022")?.title ?? "",
    /content search/i,
  );
  assert.match(bodyText("search-lab-post-022"), /content search/i);
  assert.match(bodyText("search-lab-post-023"), /indexing indexed indexes/i);

  assert.match(byId.get("search-lab-post-024")?.title ?? "", /signal orchard/i);
  assert.doesNotMatch(
    byId.get("search-lab-post-025")?.title ?? "",
    /signal orchard/i,
  );
  assert.match(bodyText("search-lab-post-025"), /signal orchard/i);
});
