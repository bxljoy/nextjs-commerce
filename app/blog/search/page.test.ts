import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { SearchUnavailableError } from "../../../lib/search/elasticsearch.ts";
import { parseSearchInput } from "../../../lib/search/input.ts";
import { formatDate } from "../../../lib/sanity/utils.ts";

const SEARCH_PAGE_PATH = path.join(import.meta.dirname, "page.tsx");
const BLOG_PAGE_PATH = path.join(import.meta.dirname, "..", "page.tsx");

type SearchPublishedPosts = (input: {
  query: string;
  page: number;
}) => Promise<{
  results: Array<{
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    publishedAt: string;
    score: number | null;
  }>;
  total: number;
  page: number;
  pageSize: 10;
}>;

type PageComponent = (props: {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
  }>;
}) => Promise<React.ReactNode>;

async function loadComponent(
  filePath: string,
  mocks: Record<string, unknown>,
): Promise<unknown> {
  const source = await readFile(filePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const require = (specifier: string) => {
    if (specifier in mocks) return mocks[specifier];
    if (specifier === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`Unexpected test import: ${specifier}`);
  };

  Function(
    "require",
    "module",
    "exports",
    compiled,
  )(require, module, module.exports);
  return module.exports.default;
}

function Link({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return React.createElement("a", { ...props, href }, children);
}

async function renderSearchPage(
  searchParams: { q?: string | string[]; page?: string | string[] },
  searchPublishedPosts: SearchPublishedPosts,
): Promise<string> {
  const Component = (await loadComponent(SEARCH_PAGE_PATH, {
    "lib/sanity/utils": { formatDate },
    "lib/search/elasticsearch": { SearchUnavailableError },
    "lib/search/input": { parseSearchInput, SEARCH_PAGE_SIZE: 10 },
    "lib/search/server": { searchPublishedPosts },
    "next/link": { __esModule: true, default: Link },
  })) as PageComponent;

  return renderToStaticMarkup(
    await Component({ searchParams: Promise.resolve(searchParams) }),
  );
}

test("renders results as text with exact totals and query-preserving pagination", async () => {
  const calls: Array<{ query: string; page: number }> = [];
  const html = await renderSearchPage(
    { q: "  caching & search  ", page: "2" },
    async (input) => {
      calls.push(input);
      return {
        results: [
          {
            id: "post.1",
            slug: "safe-result",
            title: "<script>Unsafe title</script>",
            excerpt: "A plain-text excerpt.",
            publishedAt: "2026-01-02T00:00:00.000Z",
            score: 1,
          },
        ],
        total: 25,
        page: 2,
        pageSize: 10,
      };
    },
  );

  assert.deepEqual(calls, [{ query: "caching & search", page: 2 }]);
  assert.match(html, /method="get"/);
  assert.match(html, /name="q"/);
  assert.match(html, /25 posts found/);
  assert.match(html, /Page 2/);
  assert.match(html, /&lt;script&gt;Unsafe title&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>Unsafe title<\/script>/);
  assert.match(html, /A plain-text excerpt\./);
  assert.match(html, /dateTime="2026-01-02T00:00:00.000Z"/);
  assert.match(html, /href="\/blog\/safe-result"/);
  assert.match(
    html,
    /href="\/blog\/search\?q=caching\+%26\+search&amp;page=1"/,
  );
  assert.match(
    html,
    /href="\/blog\/search\?q=caching\+%26\+search&amp;page=3"/,
  );
});

test("renders valid zero results distinctly and disables unavailable pagination", async () => {
  const html = await renderSearchPage({ q: "no-match" }, async () => ({
    results: [],
    total: 0,
    page: 1,
    pageSize: 10,
  }));

  assert.match(html, /0 posts found/);
  assert.match(html, /No posts matched your search/);
  assert.doesNotMatch(html, /Search is unavailable/);
  assert.match(html, /Previous<\/span>/);
  assert.match(html, /Next<\/span>/);
});

test("renders invalid input without calling Elasticsearch", async () => {
  let called = false;
  const html = await renderSearchPage({ page: "0" }, async () => {
    called = true;
    throw new Error("must not be called");
  });

  assert.equal(called, false);
  assert.match(html, /Page must be an integer from 1 to 100\./);
  assert.doesNotMatch(html, /No posts matched your search/);
});

test("renders a generic unavailable state with a link back to the blog", async () => {
  const html = await renderSearchPage({ q: "cache" }, async () => {
    throw new SearchUnavailableError();
  });

  assert.match(html, /Search is unavailable/);
  assert.match(html, /href="\/blog"/);
  assert.doesNotMatch(html, /SearchUnavailableError/);
  assert.doesNotMatch(html, /at renderSearchPage/);
  assert.doesNotMatch(html, /No posts matched your search/);
});

test("keeps the existing blog list and adds an opt-in search link", async () => {
  const Component = (await loadComponent(BLOG_PAGE_PATH, {
    "lib/sanity": {
      getPosts: async () => [
        {
          _id: "post.1",
          slug: "existing-post",
          title: "Existing post",
          publishedAt: "2026-01-02T00:00:00.000Z",
          excerpt: "Existing excerpt.",
        },
      ],
    },
    "lib/sanity/utils": {
      formatDate,
      toPlainText: () => "",
      truncate: (value: string) => value,
    },
    "next/link": { __esModule: true, default: Link },
  })) as () => Promise<React.ReactNode>;
  const html = renderToStaticMarkup(await Component());

  assert.match(html, />Blog<\/h1>/);
  assert.match(html, /href="\/blog\/search"[^>]*>Search posts<\/a>/);
  assert.match(html, /href="\/blog\/existing-post"/);
  assert.match(html, /Existing excerpt\./);
});
