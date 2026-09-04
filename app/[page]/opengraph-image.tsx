import OpengraphImage from "components/opengraph-image";
import { getPage } from "lib/sanity";

export default async function Image({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page: slug } = await params;
  const page = await getPage(slug);
  const title = page?.seo?.title || page?.title;

  return await OpengraphImage({ title });
}
