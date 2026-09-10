import { readFileSync } from "node:fs";
import { CliError } from "./errors.js";

/** Runtime configuration resolved from process environment and CLI options. */
export interface Config {
  key?: string;
  userId?: string;
  timeoutMs: number;
  format: "human" | "json";
  noInput: boolean;
}

/** Load only supported test/CI variables without overriding the process environment. */
export function loadExplicitEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new CliError("USAGE", `cannot read env file: ${path}`);
  }
  for (const [lineNumber, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match)
      throw new CliError(
        "USAGE",
        `invalid env file syntax on line ${lineNumber + 1}`,
      );
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (
      (match[1] === "ZOTERO_KEY" || match[1] === "ZOTERO_USER_ID") &&
      process.env[match[1]] === undefined
    )
      process.env[match[1]] = value;
  }
}

/** Validate CLI configuration before any authenticated network operation. */
export function loadConfig(options: {
  userId?: string;
  timeout?: string;
  format?: string;
  noInput?: boolean;
}): Config {
  const userId = options.userId ?? process.env.ZOTERO_USER_ID;
  if (userId !== undefined && !/^\d+$/.test(userId))
    throw new CliError("USAGE", "user ID must be numeric");
  const timeout = options.timeout === undefined ? 30 : Number(options.timeout);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300)
    throw new CliError(
      "USAGE",
      "timeout must be an integer from 1 to 300 seconds",
    );
  const format = (options.format ?? "human") as Config["format"];
  if (format !== "human" && format !== "json")
    throw new CliError("USAGE", "format must be human or json");
  return {
    key: process.env.ZOTERO_KEY,
    userId,
    timeoutMs: timeout * 1000,
    format,
    noInput: Boolean(options.noInput),
  };
}

export function requireKey(config: Config): string {
  if (!config.key)
    throw new CliError(
      "AUTH",
      "no Zotero credentials are configured",
      false,
      "Run `zotero auth login` or provide ZOTERO_KEY for CI.",
    );
  return config.key;
}
