import {
  PortableText as PortableTextRenderer,
  type PortableTextComponents,
} from "@portabletext/react";
import clsx from "clsx";
import Link from "next/link";
import type { SanityBody } from "lib/sanity/types";

const components: PortableTextComponents = {
  block: {
    h1: ({ children }) => (
      <h1 className="mb-4 mt-8 text-4xl font-bold">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-4 mt-8 text-3xl font-bold">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-3 mt-6 text-2xl font-bold">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-3 mt-6 text-xl font-bold">{children}</h4>
    ),
    normal: ({ children }) => (
      <p className="mb-4 leading-relaxed">{children}</p>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-6 border-l-4 border-neutral-300 pl-4 italic dark:border-neutral-700">
        {children}
      </blockquote>
    ),
  },
  list: {
    bullet: ({ children }) => (
      <ul className="mb-4 list-disc pl-6">{children}</ul>
    ),
    number: ({ children }) => (
      <ol className="mb-4 list-decimal pl-6">{children}</ol>
    ),
  },
  listItem: {
    bullet: ({ children }) => <li className="mb-1">{children}</li>,
    number: ({ children }) => <li className="mb-1">{children}</li>,
  },
  marks: {
    strong: ({ children }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    code: ({ children }) => (
      <code className="rounded-sm bg-neutral-100 px-1 py-0.5 text-sm dark:bg-neutral-800">
        {children}
      </code>
    ),
    link: ({ children, value }) => {
      const href = String(value?.href ?? "");
      const isInternal = href.startsWith("/");

      if (isInternal) {
        return (
          <Link
            href={href}
            className="text-blue-600 underline underline-offset-4"
          >
            {children}
          </Link>
        );
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline underline-offset-4"
        >
          {children}
        </a>
      );
    },
  },
  types: {
    // No image assets exist in the dataset yet. Rendering nothing keeps a
    // later-added image from crashing the page; swap in `@sanity/image-url`
    // and next/image when images actually get used.
    image: () => null,
  },
};

export default function PortableText({
  value,
  className,
}: {
  value?: SanityBody;
  className?: string;
}) {
  if (!value?.length) return null;

  return (
    <div className={clsx("text-base", className)}>
      <PortableTextRenderer value={value} components={components} />
    </div>
  );
}
