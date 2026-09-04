import PortableText from "components/portable-text";
import { getPost } from "lib/sanity";
import { formatDate, toPlainText, truncate } from "lib/sanity/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const post = await getPost(slug);

  if (!post) return notFound();

  return {
    title: post.seo?.title || post.title,
    description:
      post.seo?.description || post.excerpt || truncate(toPlainText(post.body)),
    openGraph: {
      publishedTime: post.publishedAt,
      modifiedTime: post._updatedAt,
      type: "article",
    },
  };
}

export default async function BlogPostPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const post = await getPost(slug);

  if (!post) return notFound();

  return (
    <>
      <Link
        href="/blog"
        className="mb-8 inline-block text-sm text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
      >
        ← All posts
      </Link>
      <h1 className="mb-2 text-5xl font-bold">{post.title}</h1>
      <p className="mb-8 text-sm text-neutral-500 dark:text-neutral-400">
        <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
      </p>
      <PortableText value={post.body} />
    </>
  );
}
