import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(fixtureDir, "../..");
const dataFile = resolve(fixtureDir, "data/isr.json");
const originPort = Number(process.env.CACHE_LAB_ORIGIN_PORT || 4311);
const appPort = Number(process.env.CACHE_LAB_APP_PORT || 4312);
const originUrl = `http://127.0.0.1:${originPort}`;
const appUrl = `http://127.0.0.1:${appPort}`;
const nextBin = resolve(rootDir, "node_modules/.bin/next");
const childProcesses = [];
let originalData;

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      ...options,
    });
    let output = "";

    child.stdout?.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}

function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  childProcesses.push(child);
  return child;
}

async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
    } catch {}
    await sleep(100);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function json(url, init) {
  const response = await fetch(url, init);
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

async function setOrigin(key, value) {
  await json(`${originUrl}/value?key=${key}&value=${value}`, {
    method: "POST",
  });
}

async function readIsrValue() {
  const response = await fetch(`${appUrl}/isr`, { cache: "no-store" });
  assert.equal(response.ok, true);
  const html = await response.text();
  const match = html.match(/data-origin-value="([^"]+)"/);
  assert.ok(match, "ISR page did not expose its controlled origin value");
  return match[1];
}

async function waitForIsrValue(expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let actual;

  while (Date.now() < deadline) {
    actual = await readIsrValue();
    if (actual === expected) return;
    await sleep(100);
  }

  assert.equal(actual, expected, "ISR regeneration did not finish in time");
}

try {
  await mkdir(dirname(dataFile), { recursive: true });
  try {
    originalData = await readFile(dataFile, "utf8");
  } catch {
    originalData = undefined;
  }
  await writeFile(dataFile, '{"value":"isr-one","fail":false}\n');
  await rm(resolve(fixtureDir, ".next"), { recursive: true, force: true });

  console.log("\n[cache-lab] Building the isolated fixture");
  const buildOutput = await run(nextBin, ["build", fixtureDir], {
    env: {
      ...process.env,
      CACHE_LAB_DATA_FILE: dataFile,
      CACHE_LAB_ORIGIN_URL: originUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(buildOutput, /○ \/isr/);

  console.log("\n[cache-lab] Starting controlled origin and Next server");
  start(process.execPath, [resolve(fixtureDir, "origin.mjs")], {
    CACHE_LAB_ORIGIN_PORT: String(originPort),
  });
  await waitFor(`${originUrl}/health`);
  start(
    nextBin,
    ["start", fixtureDir, "-H", "127.0.0.1", "-p", String(appPort)],
    {
      CACHE_LAB_DATA_FILE: dataFile,
      CACHE_LAB_ORIGIN_URL: originUrl,
    },
  );
  await waitFor(appUrl);

  console.log("\n[cache-lab] Data Cache reuse and key isolation");
  const firstA = await json(`${appUrl}/api/data?key=A`);
  const secondA = await json(`${appUrl}/api/data?key=A`);
  const firstB = await json(`${appUrl}/api/data?key=B`);
  assert.deepEqual(secondA, firstA);
  assert.equal(firstA.originHits, 1);
  assert.equal(firstB.originHits, 1);

  console.log("\n[cache-lab] Time-based stale-while-revalidate");
  await setOrigin("A", "two");
  assert.equal((await json(`${appUrl}/api/data?key=A`)).value, "one");
  await sleep(2300);
  const staleA = await json(`${appUrl}/api/data?key=A`);
  assert.equal(staleA.value, "one");
  await sleep(500);
  const refreshedA = await json(`${appUrl}/api/data?key=A`);
  assert.equal(refreshedA.value, "two");
  assert.equal(refreshedA.originHits, 2);

  console.log("\n[cache-lab] On-demand tag invalidation");
  await setOrigin("A", "three");
  await json(`${appUrl}/api/revalidate?tag=lab:A`, { method: "POST" });
  const invalidatedA = await json(`${appUrl}/api/data?key=A`);
  assert.equal(invalidatedA.value, "three");
  assert.equal(invalidatedA.originHits, 3);

  console.log("\n[cache-lab] Uncached cart isolation with two cookie jars");
  const userA = { headers: { cookie: "cartId=user-a" } };
  const userB = { headers: { cookie: "cartId=user-b" } };
  await json(`${appUrl}/api/cart?item=apple`, { ...userA, method: "POST" });
  await json(`${appUrl}/api/cart?item=banana`, { ...userB, method: "POST" });
  const cartA = await json(`${appUrl}/api/cart`, userA);
  const cartB = await json(`${appUrl}/api/cart`, userB);
  assert.deepEqual(cartA.items, ["apple"]);
  assert.deepEqual(cartB.items, ["banana"]);
  assert.notEqual(cartA.cartId, cartB.cartId);
  assert.equal((await json(`${appUrl}/api/cart`, userA)).originHits, 3);

  console.log("\n[cache-lab] Full Route Cache / ISR stale regeneration");
  assert.equal(await readIsrValue(), "isr-one");
  await writeFile(dataFile, '{"value":"isr-two","fail":false}\n');
  await sleep(2300);
  assert.equal(await readIsrValue(), "isr-one");
  await waitForIsrValue("isr-two");

  console.log("\n[cache-lab] ISR retains stale output on origin failure");
  await writeFile(dataFile, '{"value":"ignored","fail":true}\n');
  await sleep(2300);
  assert.equal(await readIsrValue(), "isr-two");
  await sleep(500);
  assert.equal(await readIsrValue(), "isr-two");

  console.log("\n[cache-lab] ISR recovers after the origin recovers");
  await writeFile(dataFile, '{"value":"isr-three","fail":false}\n');
  await sleep(2300);
  assert.equal(await readIsrValue(), "isr-two");
  await waitForIsrValue("isr-three");

  console.log("\n[cache-lab] PASS: all cache-layer observations matched");
} finally {
  for (const child of childProcesses.reverse()) child.kill("SIGTERM");
  if (originalData === undefined) {
    await writeFile(dataFile, '{"value":"isr-one","fail":false}\n');
  } else {
    await writeFile(dataFile, originalData);
  }
}
