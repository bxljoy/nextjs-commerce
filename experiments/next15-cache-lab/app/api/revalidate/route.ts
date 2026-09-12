import { revalidateTag } from "next/cache";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const tag = new URL(request.url).searchParams.get("tag");
  if (!tag || !/^lab:[A-Za-z0-9_-]+$/.test(tag)) {
    return Response.json({ error: "Invalid tag" }, { status: 400 });
  }

  revalidateTag(tag);
  return Response.json({ revalidated: true, tag });
}
