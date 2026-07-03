import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";

const ZIP_PATH = "https://reading-block.example.com/downloads/reading-block-lark-extension.zip";

test("serves the extension zip from R2", async () => {
  const env = { DOWNLOADS: fakeDownloadsBucket() };
  const res = await worker.fetch(new Request(ZIP_PATH), env, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/zip");
  assert.equal(res.headers.get("Content-Disposition"), 'attachment; filename="reading-block-lark-extension.zip"');
  assert.equal(res.headers.get("Content-Length"), "8");
  assert.equal(await res.text(), "zip-body");
});

test("supports HEAD for the extension zip", async () => {
  const env = { DOWNLOADS: fakeDownloadsBucket() };
  const res = await worker.fetch(new Request(ZIP_PATH, { method: "HEAD" }), env, {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Length"), "8");
  assert.equal(await res.text(), "");
});

function fakeDownloadsBucket() {
  const object = {
    size: 8,
    etag: "fake-etag",
    httpEtag: '"fake-etag"',
    body: new Blob(["zip-body"]).stream(),
    writeHttpMetadata(headers) {
      headers.set("Content-Type", "application/octet-stream");
    },
  };
  return {
    async get(key) {
      assert.equal(key, "reading-block-lark-extension.zip");
      return object;
    },
    async head(key) {
      assert.equal(key, "reading-block-lark-extension.zip");
      return { ...object, body: undefined };
    },
  };
}
