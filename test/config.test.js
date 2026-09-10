import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExplicitEnvFile } from "../dist/config.js";

test("explicit env files do not override process environment credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zotero-cli-"));
  const path = join(directory, ".env");
  const originalKey = process.env.ZOTERO_KEY;
  const originalUserId = process.env.ZOTERO_USER_ID;
  try {
    process.env.ZOTERO_KEY = "process-key";
    process.env.ZOTERO_USER_ID = "123";
    await writeFile(path, "ZOTERO_KEY=file-key\nZOTERO_USER_ID=456\n");
    loadExplicitEnvFile(path);
    assert.equal(process.env.ZOTERO_KEY, "process-key");
    assert.equal(process.env.ZOTERO_USER_ID, "123");
  } finally {
    if (originalKey === undefined) delete process.env.ZOTERO_KEY;
    else process.env.ZOTERO_KEY = originalKey;
    if (originalUserId === undefined) delete process.env.ZOTERO_USER_ID;
    else process.env.ZOTERO_USER_ID = originalUserId;
    await rm(directory, { recursive: true, force: true });
  }
});

test("redirect host overrides require bare DNS hostnames", async () => {
  const { loadConfig } = await import("../dist/config.js");
  assert.deepEqual(
    loadConfig({ allowRedirectHost: ["Storage.Example.com"] }).redirectHosts,
    ["storage.example.com"],
  );
  assert.throws(
    () =>
      loadConfig({ allowRedirectHost: ["https://storage.example.com/path"] }),
    /invalid redirect hostname/,
  );
});
