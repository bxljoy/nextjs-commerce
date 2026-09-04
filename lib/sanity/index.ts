import { TAGS } from "lib/constants";
import {
  unstable_cacheLife as cacheLife,
  unstable_cacheTag as cacheTag,
} from "next/cache";
import { isSanityConfigured, sanityClient } from "./client";
import { pageQuery, pagesQuery, postQuery, postsQuery } from "./queries";
import type { Page, Post } from "./types";

export async function getPage(slug: string): Promise<Page | undefined> {
  "use cache";
  cacheTag(TAGS.pages);
  cacheLife("days");

  if (!isSanityConfigured) {
    console.log(`Skipping getPage for '${slug}' - Sanity not configured`);
    return undefined;
  }

  const page = await sanityClient!.fetch<Page | null>(pageQuery, { slug });
  return page ?? undefined;
}

export async function getPages(): Promise<Page[]> {
  "use cache";
  cacheTag(TAGS.pages);
  cacheLife("days");

  if (!isSanityConfigured) {
    console.log("Skipping getPages - Sanity not configured");
    return [];
  }

  return await sanityClient!.fetch<Page[]>(pagesQuery);
}

export async function getPost(slug: string): Promise<Post | undefined> {
  "use cache";
  cacheTag(TAGS.posts);
  cacheLife("days");

  if (!isSanityConfigured) {
    console.log(`Skipping getPost for '${slug}' - Sanity not configured`);
    return undefined;
  }

  const post = await sanityClient!.fetch<Post | null>(postQuery, { slug });
  return post ?? undefined;
}

export async function getPosts(): Promise<Post[]> {
  "use cache";
  cacheTag(TAGS.posts);
  cacheLife("days");

  if (!isSanityConfigured) {
    console.log("Skipping getPosts - Sanity not configured");
    return [];
  }

  return await sanityClient!.fetch<Post[]>(postsQuery);
}
