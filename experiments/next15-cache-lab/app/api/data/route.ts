export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const origin = process.env.CACHE_LAB_ORIGIN_URL;
  if (!origin) {
    return Response.json(
      { error: "Missing controlled origin" },
      { status: 500 },
    );
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) {
    return Response.json({ error: "Invalid key" }, { status: 400 });
  }

  const response = await fetch(
    `${origin}/value?key=${encodeURIComponent(key)}`,
    {
      cache: "force-cache",
      next: {
        revalidate: 2,
        tags: [`lab:${key}`],
      },
    },
  );

  return Response.json(await response.json(), { status: response.status });
}
