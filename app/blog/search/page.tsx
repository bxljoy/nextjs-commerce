import { formatDate } from "lib/sanity/utils";
import { SearchUnavailableError } from "lib/search/elasticsearch";
import { parseSearchInput, SEARCH_PAGE_SIZE } from "lib/search/input";
import { searchPublishedPosts } from "lib/search/server";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Search posts",
  description: "Search published blog posts.",
};

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string | string[];
  page?: string | string[];
};

function pageHref(query: string, page: number): string {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("page", String(page));
  return `/blog/search?${params.toString()}`;
}

function SearchForm({ query }: { query: string }) {
  return (
    <form action="/blog/search" method="get" className="mb-8 flex gap-3">
      <label className="flex-1">
        <span className="sr-only">Search blog posts</span>
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search posts"
          className="w-full rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700"
        />
      </label>
      <button
        type="submit"
        className="rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black"
      >
        Search
      </button>
    </form>
  );
}

function SearchHeading({ query }: { query: string }) {
  return (
    <>
      <Link
        href="/blog"
        className="mb-6 inline-block text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
      >
        ← All posts
      </Link>
      <h1 className="mb-8 text-5xl font-bold">Search posts</h1>
      <SearchForm query={query} />
    </>
  );
}

export default async function BlogSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = await searchParams;
  const parsed = parseSearchInput(rawSearchParams);
  const formQuery =
    typeof rawSearchParams.q === "string" ? rawSearchParams.q : "";

  if (!parsed.ok) {
    return (
      <>
        <SearchHeading query={formQuery} />
        <p role="alert" className="text-neutral-700 dark:text-neutral-300">
          {parsed.message}
        </p>
      </>
    );
  }

  let searchPage;
  try {
    searchPage = await searchPublishedPosts(parsed.value);
  } catch (error) {
    if (!(error instanceof SearchUnavailableError)) {
      throw error;
    }

    return (
      <>
        <SearchHeading query={parsed.value.query} />
        <h2 className="mb-3 text-2xl font-semibold">Search is unavailable</h2>
        <p className="text-neutral-700 dark:text-neutral-300">
          The local search service could not be reached. You can still browse{" "}
          <Link href="/blog" className="underline underline-offset-4">
            all blog posts
          </Link>
          .
        </p>
      </>
    );
  }

  const previousDisabled = searchPage.page === 1;
  const nextDisabled = searchPage.page * SEARCH_PAGE_SIZE >= searchPage.total;

  return (
    <>
      <SearchHeading query={parsed.value.query} />
      <p className="mb-8 text-sm text-neutral-500 dark:text-neutral-400">
        {searchPage.total} {searchPage.total === 1 ? "post" : "posts"} found.
        Page {searchPage.page}.
      </p>

      {searchPage.results.length === 0 ? (
        <p className="text-neutral-700 dark:text-neutral-300">
          No posts matched your search.
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {searchPage.results.map((post) => (
            <li
              key={post.id}
              className="border-b border-neutral-200 pb-8 last:border-0 dark:border-neutral-700"
            >
              <h2 className="mb-2 text-2xl font-semibold">
                <Link
                  href={`/blog/${post.slug}`}
                  className="underline-offset-4 hover:underline"
                >
                  {post.title}
                </Link>
              </h2>
              <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
                <time dateTime={post.publishedAt}>
                  {formatDate(post.publishedAt)}
                </time>
              </p>
              <p className="leading-relaxed text-neutral-700 dark:text-neutral-300">
                {post.excerpt}
              </p>
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Search result pages" className="mt-8 flex gap-4">
        {previousDisabled ? (
          <span aria-disabled="true" className="text-neutral-400">
            Previous
          </span>
        ) : (
          <Link
            href={pageHref(parsed.value.query, searchPage.page - 1)}
            className="underline underline-offset-4"
          >
            Previous
          </Link>
        )}
        {nextDisabled ? (
          <span aria-disabled="true" className="text-neutral-400">
            Next
          </span>
        ) : (
          <Link
            href={pageHref(parsed.value.query, searchPage.page + 1)}
            className="underline underline-offset-4"
          >
            Next
          </Link>
        )}
      </nav>
    </>
  );
}
