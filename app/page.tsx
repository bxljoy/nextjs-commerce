import { Carousel } from "components/carousel";
import { ThreeItemGrid } from "components/grid/three-items";
import Footer from "components/layout/footer";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  description:
    "High-performance ecommerce store built with Next.js, Vercel, and Shopify.",
  openGraph: {
    type: "website",
  },
};

// Matches the real tile chrome in `components/grid/tile.tsx` so the skeleton
// swaps out without a visual jump.
const skeletonTile =
  "animate-pulse rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800";

function ThreeItemGridSkeleton() {
  return (
    <section className="mx-auto grid max-w-(--breakpoint-2xl) gap-4 px-4 pb-4 md:grid-cols-6 md:grid-rows-2 lg:max-h-[calc(100vh-200px)]">
      <div className="md:col-span-4 md:row-span-2">
        <div className={`aspect-square h-full w-full ${skeletonTile}`} />
      </div>
      <div className="md:col-span-2 md:row-span-1">
        <div className={`aspect-square h-full w-full ${skeletonTile}`} />
      </div>
      <div className="md:col-span-2 md:row-span-1">
        <div className={`aspect-square h-full w-full ${skeletonTile}`} />
      </div>
    </section>
  );
}

function CarouselSkeleton() {
  return (
    <div className="w-full overflow-x-auto pb-6 pt-1">
      <ul className="flex gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <li
            key={index}
            className="relative aspect-square h-[30vh] max-h-[275px] w-2/3 max-w-[475px] flex-none md:w-1/3"
          >
            <div className={`h-full w-full ${skeletonTile}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <Suspense fallback={<ThreeItemGridSkeleton />}>
        <ThreeItemGrid />
      </Suspense>
      <Suspense fallback={<CarouselSkeleton />}>
        <Carousel />
      </Suspense>
      <Footer />
    </>
  );
}
