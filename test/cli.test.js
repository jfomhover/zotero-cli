import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function run(args, env = {}) {
  return new Promise((resolve) => {
    const {
      ZOTERO_KEY: _key,
      ZOTERO_USER_ID: _userId,
      ...cleanEnv
    } = process.env;
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      env: { ...cleanEnv, ...env },
      windowsHide: true,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("help is available without credentials", async () => {
  const result = await run(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Read-only CLI/);
  assert.equal(result.stderr, "");
});
test("missing credentials is a structured auth error", async () => {
  const result = await run(["--format", "json", "auth", "whoami"]);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /auth login|ZOTERO_KEY/);
  assert.equal(result.stdout, "");
});
test("OAuth login requires client credentials before opening a browser", async () => {
  const result = await run(["--format", "json", "auth", "login"]);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /OAuth client credentials/);
});
test("invalid user id fails before network access", async () => {
  const result = await run([
    "--format",
    "json",
    "--user-id",
    "not-a-number",
    "items",
    "list",
  ]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /numeric/);
});
test("invalid item include fails before identity discovery", async () => {
  const result = await run([
    "--format",
    "json",
    "items",
    "get",
    "ABCD1234",
    "--include",
    "nope",
  ]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /include values/);
});
test("invalid scope fails before network access", async () => {
  const result = await run([
    "--format",
    "json",
    "--user-id",
    "123",
    "collections",
    "list",
    "--scope",
    "other",
  ]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /scope must be user or group/);
});
test("unknown options use the structured usage error contract", async () => {
  const result = await run(["--format", "json", "--bad"]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unknown option/);
  assert.equal(result.stderr.match(/unknown option/g)?.length, 1);
});
