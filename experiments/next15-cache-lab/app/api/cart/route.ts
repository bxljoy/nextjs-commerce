import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

async function cartRequest(request: Request, method: "GET" | "POST") {
  const origin = process.env.CACHE_LAB_ORIGIN_URL;
  if (!origin) {
    return Response.json(
      { error: "Missing controlled origin" },
      { status: 500 },
    );
  }

  const cartId = (await cookies()).get("cartId")?.value;
  if (!cartId) {
    return Response.json({ error: "Missing cart cookie" }, { status: 401 });
  }

  const item = new URL(request.url).searchParams.get("item");
  if (method === "POST" && !item) {
    return Response.json({ error: "Missing item" }, { status: 400 });
  }

  const url = new URL("/cart", origin);
  url.searchParams.set("cartId", cartId);
  if (item) url.searchParams.set("item", item);

  const response = await fetch(url, {
    method,
    cache: "no-store",
  });

  return Response.json(await response.json(), { status: response.status });
}

export function GET(request: Request): Promise<Response> {
  return cartRequest(request, "GET");
}

export function POST(request: Request): Promise<Response> {
  return cartRequest(request, "POST");
}
