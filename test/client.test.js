import test from "node:test";
import assert from "node:assert/strict";
import { ZoteroClient } from "../dist/client.js";

const config = {
  key: "secret-key",
  userId: "123",
  timeoutMs: 1000,
  format: "json",
  noInput: true,
};

test("attachment redirects strip the API key and allow Zotero storage", async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers) });
    if (requests.length === 1)
      return new Response(null, {
        status: 302,
        headers: { location: "https://files.zotero.net/object" },
      });
    return new Response("pdf bytes", { status: 200 });
  };
  const response = await new ZoteroClient(config, fetcher).getBinary(
    "/users/123/items/ABCD1234/file",
  );
  assert.equal(response.status, 200);
  assert.equal(requests[0].headers.get("Zotero-API-Key"), "secret-key");
  assert.equal(requests[1].headers.get("Zotero-API-Key"), null);
});

test("malformed JSON is a provider error", async () => {
  const fetcher = async () =>
    new Response("{not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(
    () => new ZoteroClient(config, fetcher).get("/users/123/items"),
    /malformed JSON/,
  );
});

test("pagination follows only API next links", async () => {
  const fetcher = async (url) => {
    const start = new URL(url).searchParams.get("start");
    return start === "0"
      ? new Response(JSON.stringify([{ key: "A" }]), {
          status: 200,
          headers: {
            "Total-Results": "2",
            link: '<https://api.zotero.org/users/123/items?start=1&limit=1>; rel="next"',
          },
        })
      : new Response(JSON.stringify([{ key: "B" }]), {
          status: 200,
          headers: { "Total-Results": "2" },
        });
  };
  const result = await new ZoteroClient(config, fetcher).page(
    "/users/123/items",
    new URLSearchParams({ limit: "1", start: "0" }),
    true,
  );
  assert.deepEqual(
    result.data.map((item) => item.key),
    ["A", "B"],
  );
  assert.equal(result.complete, true);
});
