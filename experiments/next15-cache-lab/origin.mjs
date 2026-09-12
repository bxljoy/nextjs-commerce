import { createServer } from "node:http";

const port = Number(process.env.CACHE_LAB_ORIGIN_PORT || 4311);
const values = new Map();
const hits = new Map();
const carts = new Map();
const cartHits = new Map();

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ready: true });
    return;
  }

  if (url.pathname === "/cart") {
    const cartId = url.searchParams.get("cartId");
    if (!cartId) {
      send(response, 400, { error: "Missing cartId" });
      return;
    }

    const originHits = (cartHits.get(cartId) || 0) + 1;
    cartHits.set(cartId, originHits);
    const items = carts.get(cartId) || [];

    if (request.method === "POST") {
      const item = url.searchParams.get("item");
      if (!item) {
        send(response, 400, { error: "Missing item" });
        return;
      }
      items.push(item);
      carts.set(cartId, items);
    }

    send(response, 200, { cartId, items, originHits });
    return;
  }

  if (url.pathname !== "/value") {
    send(response, 404, { error: "Not found" });
    return;
  }

  const key = url.searchParams.get("key");
  if (!key) {
    send(response, 400, { error: "Missing key" });
    return;
  }

  if (request.method === "POST") {
    values.set(key, url.searchParams.get("value") || "");
    send(response, 200, { key, value: values.get(key) });
    return;
  }

  if (request.method === "GET") {
    const originHits = (hits.get(key) || 0) + 1;
    hits.set(key, originHits);
    send(response, 200, {
      key,
      value: values.get(key) || "one",
      originHits,
    });
    return;
  }

  send(response, 405, { error: "Method not allowed" });
}).listen(port, "127.0.0.1", () => {
  console.log(`[cache-lab-origin] listening on http://127.0.0.1:${port}`);
});
