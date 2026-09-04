import type { PortableTextBlock } from "@portabletext/types";
import type { SanityBody } from "./types";

const isTextBlock = (node: SanityBody[number]): node is PortableTextBlock =>
  Boolean(node) && (node as { _type?: string })._type === "block";

/**
 * Flattens Portable Text to plain text. Used for excerpt and meta-description
 * fallbacks when an author leaves those fields empty.
 */
export function toPlainText(body?: SanityBody): string {
  if (!body?.length) return "";

  return body
    .filter(isTextBlock)
    .map((block) =>
      (block.children ?? [])
        .map((child) => {
          const text = (child as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        })
        .join(""),
    )
    .join(" ")
    .trim();
}

/** Truncates on a word boundary so fallbacks don't cut mid-word. */
export function truncate(text: string, max = 160): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}
