import { getPosts } from "lib/sanity";
import { formatDate, toPlainText, truncate } from "lib/sanity/utils";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Blog",
  description: "Writing from the store.",
};

export default async function BlogIndexPage() {
  const posts = await getPosts();

  return (
    <>
      <h1 className="mb-8 text-5xl font-bold">Blog</h1>

      {posts.length === 0 ? (
        <p className="text-neutral-500 dark:text-neutral-400">
          No posts yet. Check back soon.
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {posts.map((post) => (
            <li
              key={post._id}
              className="border-b border-neutral-200 pb-8 last:border-0 dark:border-neutral-700"
            >
              <Link href={`/blog/${post.slug}`} className="group block">
                <h2 className="mb-2 text-2xl font-semibold group-hover:underline">
                  {post.title}
                </h2>
                <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
                  <time dateTime={post.publishedAt}>
                    {formatDate(post.publishedAt)}
                  </time>
                </p>
                <p className="leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {post.excerpt || truncate(toPlainText(post.body))}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
