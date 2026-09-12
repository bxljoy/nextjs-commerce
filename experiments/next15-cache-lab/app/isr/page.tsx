import { readFile } from "node:fs/promises";
import Link from "next/link";

export const dynamic = "force-static";
export const revalidate = 2;

type OriginState = {
  value: string;
  fail: boolean;
};

async function readOrigin(): Promise<OriginState> {
  const path = process.env.CACHE_LAB_DATA_FILE;
  if (!path) throw new Error("CACHE_LAB_DATA_FILE is required");

  const state = JSON.parse(await readFile(path, "utf8")) as OriginState;
  if (state.fail) throw new Error("Controlled cache-lab origin failure");
  return state;
}

export default async function Page() {
  const state = await readOrigin();

  return (
    <main data-origin-value={state.value}>
      <h1>ISR experiment</h1>
      <p>{state.value}</p>
      <time dateTime={new Date().toISOString()}>{Date.now()}</time>
      <Link href="/">Return to cache lab</Link>
    </main>
  );
}
