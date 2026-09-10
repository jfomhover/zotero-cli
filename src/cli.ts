#!/usr/bin/env node
import { Command } from "commander";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  loadConfig,
  loadExplicitEnvFile,
  requireKey,
  type Config,
} from "./config.js";
import { ZoteroClient, libraryPath, safeKey } from "./client.js";
import { CliError, exitCode, safeDisplay, safeMessage } from "./errors.js";
import { login } from "./oauth.js";
import { clearAuth, readAuth, writeAuth } from "./keychain.js";

const version = "0.1.0";
const program = new Command()
  .name("zotero")
  .description("Read-only CLI for the Zotero Web API")
  .version(version)
  .showSuggestionAfterError()
  .configureOutput({ writeErr: () => {} })
  .exitOverride();
program
  .option("--format <format>", "human or json", "human")
  .option("--timeout <seconds>", "request timeout, 1-300 seconds", "30")
  .option("--no-input")
  .option("--user-id <id>", "numeric personal library ID")
  .option(
    "--env-file <path>",
    "explicitly load ZOTERO_KEY/ZOTERO_USER_ID from a file",
  );
const opts = (command: Command) => {
  let root = command;
  while (root.parent) root = root.parent;
  return root.opts();
};
function context(command: Command): { config: Config; client: ZoteroClient } {
  const config = loadConfig(opts(command));
  return { config, client: new ZoteroClient(config) };
}
function out(config: Config, data: unknown, human: string) {
  if (config.format === "json")
    process.stdout.write(JSON.stringify({ version: 1, data }) + "\n");
  else process.stdout.write(safeDisplay(human) + "\n");
}
function objectBody(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CliError(
      "PROVIDER",
      `Zotero returned an invalid ${label} response`,
    );
  return value as Record<string, unknown>;
}
function listOut(
  config: Config,
  page: {
    data: unknown[];
    total: number;
    limit: number;
    start: number;
    next: number | null;
    complete: boolean;
  },
  title: string,
) {
  if (config.format === "json")
    process.stdout.write(
      JSON.stringify({
        version: 1,
        data: page.data,
        pagination: {
          total: page.total,
          limit: page.limit,
          start: page.start,
          next: page.next,
          complete: page.complete,
        },
      }) + "\n",
    );
  else
    process.stdout.write(
      page.data.length
        ? page.data
            .map((x) =>
              typeof x === "object" && x
                ? safeDisplay(
                    `${(x as any).key ?? ""}\t${(x as any).data?.title ?? (x as any).name ?? ""}`,
                  ).trim()
                : safeDisplay(x),
            )
            .join("\n") + "\n"
        : `${safeDisplay(title)}: no results\n`,
    );
}
function addListOptions(command: Command) {
  return command
    .option("--limit <n>", "results per page (1-100)", "25")
    .option("--start <n>", "starting offset", "0")
    .option("--all", "fetch up to 100 pages/10,000 records");
}
function listParams(
  command: Command,
  extra: Record<string, string | undefined>,
): { params: URLSearchParams; all: boolean } {
  const o = command.optsWithGlobals();
  const limit = Number(o.limit);
  const start = Number(o.start);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(start) ||
    start < 0
  )
    throw new CliError(
      "USAGE",
      "limit must be 1-100 and start must be a non-negative integer",
    );
  const params = new URLSearchParams({
    limit: String(limit),
    start: String(start),
  });
  for (const [k, v] of Object.entries(extra))
    if (v !== undefined) params.set(k, v);
  return { params, all: Boolean(o.all) };
}
async function scope(command: Command, config: Config, client: ZoteroClient) {
  const o = command.optsWithGlobals();
  const ownerId =
    config.userId ??
    (o.scope !== "group" && config.key
      ? (
          await client.get<{ userID: number }>(
            `/keys/${encodeURIComponent(config.key)}`,
          )
        ).body.userID.toString()
      : undefined);
  return libraryPath(o.scope, o.libraryId, config, ownerId);
}

const auth = program.command("auth");
auth
  .command("login")
  .description("Authorize this CLI with Zotero in a browser")
  .action(async function (this: Command) {
    const credentials = {
      clientKey: process.env.ZOTERO_OAUTH_CLIENT_KEY ?? "",
      clientSecret: process.env.ZOTERO_OAUTH_CLIENT_SECRET ?? "",
    };
    const stored = await login(credentials);
    await writeAuth(stored);
    process.stderr.write(
      "Zotero authorization completed. Credentials were saved in the OS credential store.\n",
    );
  });
auth
  .command("logout")
  .description("Remove saved Zotero authorization")
  .action(async function () {
    await clearAuth();
    process.stderr.write("Saved Zotero authorization removed.\n");
  });
auth
  .command("whoami")
  .description("Show the account and key privileges")
  .action(async function (this: Command) {
    const { config, client } = context(this);
    const key = requireKey(config);
    const body = objectBody(
      (await client.get(`/keys/${encodeURIComponent(key)}`)).body,
      "identity",
    );
    const userId = body.userID;
    if (typeof userId !== "number" || !Number.isInteger(userId) || userId < 1)
      throw new CliError(
        "PROVIDER",
        "Zotero returned an invalid identity response",
      );
    const identity = {
      userID: userId,
      username: typeof body.username === "string" ? body.username : undefined,
      displayName:
        typeof body.displayName === "string" ? body.displayName : undefined,
      access: body.access,
    };
    out(
      config,
      identity,
      `user ${identity.userID}${identity.username ? ` (${identity.username})` : ""}`,
    );
  });
const groups = program.command("groups");
addListOptions(
  groups.command("list").description("List groups available to the key"),
).action(async function (this: Command) {
  const { config, client } = context(this);
  const discovered = (
    await client.get<{ userID: number }>(
      `/keys/${encodeURIComponent(requireKey(config))}`,
    )
  ).body.userID;
  if (!Number.isInteger(discovered) || discovered < 1)
    throw new CliError(
      "PROVIDER",
      "Zotero returned an invalid identity response",
    );
  const user = config.userId ?? discovered;
  const p = listParams(this, {});
  const page = await client.page(`/users/${user}/groups`, p.params, p.all);
  listOut(config, page, "groups");
});
const collections = program.command("collections");
addListOptions(
  collections
    .command("list")
    .option("--scope <scope>", "user or group", "user")
    .option("--library-id <id>")
    .description("List collections"),
).action(async function (this: Command) {
  const { config, client } = context(this);
  const p = listParams(this, {});
  const page = await client.page(
    `${await scope(this, config, client)}/collections`,
    p.params,
    p.all,
  );
  listOut(config, page, "collections");
});
collections
  .command("get <key>")
  .option("--scope <scope>", "user or group", "user")
  .option("--library-id <id>")
  .description("Get a collection")
  .action(async function (this: Command, key: string) {
    const { config, client } = context(this);
    const body = objectBody(
      (
        await client.get(
          `${await scope(this, config, client)}/collections/${safeKey(key)}`,
        )
      ).body,
      "collection",
    );
    out(config, body, `${(body as any).data?.name ?? key}`);
  });
const items = program.command("items");
addListOptions(
  items
    .command("list")
    .option("--scope <scope>", "user or group", "user")
    .option("--library-id <id>")
    .option("--query <text>")
    .option("--item-type <type>")
    .option("--tag <tag>")
    .option("--collection <key>")
    .description("List items"),
).action(async function (this: Command) {
  const { config, client } = context(this);
  const o = this.optsWithGlobals();
  const p = listParams(this, { q: o.query, itemType: o.itemType, tag: o.tag });
  const base = await scope(this, config, client);
  const path = o.collection
    ? `${base}/collections/${safeKey(o.collection)}/items`
    : `${base}/items`;
  const page = await client.page(path, p.params, p.all);
  listOut(config, page, "items");
});
items
  .command("get <key>")
  .option("--scope <scope>", "user or group", "user")
  .option("--library-id <id>")
  .option("--include <include>")
  .description("Get an item")
  .action(async function (this: Command, key: string) {
    const { config, client } = context(this);
    const o = this.optsWithGlobals();
    const include = o.include?.split(",") ?? [];
    if (
      include.some(
        (value: string) => !["data", "bib", "citation"].includes(value),
      )
    )
      throw new CliError(
        "USAGE",
        "--include values must be data, bib, or citation",
      );
    const path = `${await scope(this, config, client)}/items/${safeKey(key)}`;
    const body = objectBody(
      (
        await client.get(
          `${path}${o.include ? `?include=${encodeURIComponent(o.include)}` : ""}`,
        )
      ).body,
      "item",
    );
    out(config, body, `${(body as any).data?.title ?? key}`);
  });
addListOptions(
  items
    .command("children <key>")
    .option("--scope <scope>", "user or group", "user")
    .option("--library-id <id>")
    .description("List child items"),
).action(async function (this: Command, key: string) {
  const { config, client } = context(this);
  const p = listParams(this, {});
  const page = await client.page(
    `${await scope(this, config, client)}/items/${safeKey(key)}/children`,
    p.params,
    p.all,
  );
  listOut(config, page, "children");
});
items
  .command("download <key>")
  .option("--scope <scope>", "user or group", "user")
  .option("--library-id <id>")
  .option("--output <path>")
  .option("--force")
  .description("Download an attachment file")
  .action(async function (this: Command, key: string) {
    const { config, client } = context(this);
    const o = this.optsWithGlobals();
    const encodedKey = safeKey(key);
    const base = await scope(this, config, client);
    const metadata = objectBody(
      (await client.get(`${base}/items/${encodedKey}`)).body,
      "attachment",
    );
    const attachmentData = (
      metadata.data && typeof metadata.data === "object" ? metadata.data : {}
    ) as Record<string, unknown>;
    if (attachmentData.itemType !== "attachment")
      throw new CliError("USAGE", "item is not an attachment");
    const output = resolve(
      o.output ??
        basename(
          typeof attachmentData.filename === "string"
            ? attachmentData.filename
            : `${key}.pdf`,
        ),
    );
    if (existsSync(output) && !o.force)
      throw new CliError(
        "USAGE",
        `output exists: ${output}`,
        false,
        "Use --force to replace it.",
      );
    await mkdir(dirname(output), { recursive: true });
    const temp = `${output}.zotero-${process.pid}.part`;
    const abort = new AbortController();
    let cancelled = false;
    const onInterrupt = () => {
      cancelled = true;
      abort.abort();
    };
    process.once("SIGINT", onInterrupt);
    try {
      const response = await client.getBinary(
        `${base}/items/${encodedKey}/file`,
      );
      const expectedMd5 =
        typeof attachmentData.md5 === "string"
          ? attachmentData.md5.toLowerCase()
          : undefined;
      const etag = response.headers
        .get("etag")
        ?.replace(/^W\//, "")
        .replace(/^"|"$/g, "")
        .toLowerCase();
      if (expectedMd5 && etag && expectedMd5 !== etag)
        throw new CliError(
          "PROVIDER",
          "attachment integrity check failed; Zotero metadata may have changed",
        );
      if (!response.body)
        throw new CliError("PROVIDER", "empty attachment response");
      await pipeline(
        response.body as any,
        createWriteStream(temp, { flags: "wx" }),
        { signal: abort.signal },
      );
      if (cancelled) throw new CliError("CANCELLED", "download cancelled");
      if (!o.force && existsSync(output))
        throw new CliError(
          "USAGE",
          `output was created during download: ${output}`,
        );
      await rename(temp, output);
      out(
        config,
        { path: output, bytes: (await stat(output)).size },
        `downloaded ${output}`,
      );
    } catch (error) {
      if (cancelled) throw new CliError("CANCELLED", "download cancelled");
      throw error;
    } finally {
      process.removeListener("SIGINT", onInterrupt);
      await rm(temp, { force: true });
    }
  });
const fulltext = program.command("fulltext");
fulltext
  .command("get <key>")
  .option("--scope <scope>", "user or group", "user")
  .option("--library-id <id>")
  .description("Get indexed full text for an attachment")
  .action(async function (this: Command, key: string) {
    const { config, client } = context(this);
    const body = objectBody(
      (
        await client.get(
          `${await scope(this, config, client)}/items/${safeKey(key)}/fulltext`,
        )
      ).body,
      "full-text",
    );
    if (typeof body.content !== "string")
      throw new CliError(
        "PROVIDER",
        "Zotero returned invalid full-text content",
      );
    out(config, body, body.content);
  });
for (const [name, path] of [
  ["tags", "/tags"],
  ["searches", "/searches"] as const,
]) {
  const group = program.command(name);
  addListOptions(
    group
      .command("list")
      .option("--scope <scope>", "user or group", "user")
      .option("--library-id <id>")
      .description(`List ${name}`),
  ).action(async function (this: Command) {
    const { config, client } = context(this);
    const p = listParams(this, {});
    const page = await client.page(
      `${await scope(this, config, client)}${path}`,
      p.params,
      p.all,
    );
    listOut(config, page, name);
  });
}
const schema = program.command("schema");
for (const name of ["item-types", "item-fields", "creator-fields"] as const) {
  const endpoint = {
    "item-types": "/itemTypes",
    "item-fields": "/itemFields",
    "creator-fields": "/creatorFields",
  }[name];
  schema.command(name).action(async function (this: Command) {
    const { config, client } = context(this);
    const result = await client.get(endpoint);
    out(config, result.body, JSON.stringify(result.body));
  });
}

async function main() {
  try {
    const index = process.argv.indexOf("--env-file");
    if (index >= 0) {
      const path = process.argv[index + 1];
      if (!path || path.startsWith("-"))
        throw new CliError("USAGE", "--env-file requires a path");
      loadExplicitEnvFile(path);
    }
    if (!process.env.ZOTERO_KEY) {
      try {
        const stored = await readAuth();
        if (stored?.key) {
          process.env.ZOTERO_KEY = stored.key;
          process.env.ZOTERO_USER_ID ??= stored.userId;
        }
      } catch (error) {
        if (
          error instanceof CliError &&
          error.code === "AUTH" &&
          error.message.includes("malformed")
        )
          throw error; /* Public reads must not require a credential backend. */
      }
    }
    await program.parseAsync();
  } catch (error) {
    const commanderCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (
      commanderCode === "commander.helpDisplayed" ||
      commanderCode === "commander.version"
    ) {
      process.exitCode = 0;
      return;
    }
    const message = safeMessage(error).replace(/^CommanderError:\s*/i, "");
    const e =
      error instanceof CliError ? error : new CliError("USAGE", message);
    const config = (() => {
      try {
        return loadConfig(program.opts());
      } catch {
        return { format: "human" } as Config;
      }
    })();
    if (config.format === "json")
      process.stderr.write(
        JSON.stringify({
          version: 1,
          error: {
            code: e.code,
            message: e.message,
            retryable: e.retryable,
            ...(e.hint ? { hint: e.hint } : {}),
          },
        }) + "\n",
      );
    else
      process.stderr.write(
        `error: ${e.message}${e.hint ? `\n hint: ${e.hint}` : ""}\n`,
      );
    process.exitCode = exitCode[e.code];
  }
}
void main();
