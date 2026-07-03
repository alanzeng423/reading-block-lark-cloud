import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";

const env = {};
const ctx = {};

test("health is reachable without a browser Origin", async () => {
  const res = await worker.fetch(new Request("https://reading-block.example.com/health"), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(await res.json(), { ok: true, service: "reading-block-api" });
});

test("extension origins get explicit CORS access", async () => {
  const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const res = await worker.fetch(
    new Request("https://reading-block.example.com/health", {
      headers: { Origin: origin },
    }),
    env,
    ctx
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
});

test("ordinary website origins are rejected before OAuth can start", async () => {
  const res = await worker.fetch(
    new Request("https://reading-block.example.com/auth/lark/start", {
      method: "POST",
      headers: { Origin: "https://example.com" },
    }),
    env,
    ctx
  );
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await res.json()).error, "Origin not allowed");
});

test("extension preflight requests are accepted", async () => {
  const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const res = await worker.fetch(
    new Request("https://reading-block.example.com/auth/lark/start", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }),
    env,
    ctx
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
  assert.match(res.headers.get("Access-Control-Allow-Methods"), /POST/);
});
