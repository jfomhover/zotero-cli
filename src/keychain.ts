import type { StoredAuth } from "./oauth.js";
import { CliError } from "./errors.js";
import { SERVICE } from "./oauth.js";

const ACCOUNT = "default";
function validateAuth(value: unknown): StoredAuth | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object")
    throw new CliError(
      "AUTH",
      "stored Zotero credentials are malformed",
      false,
      "Run `zotero auth login` again.",
    );
  const record = value as Record<string, unknown>;
  if (
    typeof record.key !== "string" ||
    record.key.length === 0 ||
    typeof record.userId !== "string" ||
    !/^\d+$/.test(record.userId)
  )
    throw new CliError(
      "AUTH",
      "stored Zotero credentials are malformed",
      false,
      "Run `zotero auth login` again.",
    );
  return {
    key: record.key,
    userId: record.userId,
    ...(typeof record.username === "string"
      ? { username: record.username }
      : {}),
  };
}
async function backend() {
  try {
    return (await import("keytar")).default;
  } catch {
    throw new CliError(
      "AUTH",
      "OS credential storage is unavailable",
      false,
      "Use environment credentials for CI or install a supported OS credential-store backend.",
    );
  }
}
/** Read and validate the default account from the OS credential store. */
export async function readAuth(): Promise<StoredAuth | undefined> {
  try {
    const value = await (await backend()).getPassword(SERVICE, ACCOUNT);
    return validateAuth(value ? JSON.parse(value) : undefined);
  } catch {
    throw new CliError(
      "AUTH",
      "OS credential storage is unavailable",
      false,
      "Use environment credentials for CI or install a supported OS credential-store backend.",
    );
  }
}
/** Securely delegate credential persistence to the platform keychain backend. */
export async function writeAuth(auth: StoredAuth): Promise<void> {
  try {
    await (await backend()).setPassword(SERVICE, ACCOUNT, JSON.stringify(auth));
  } catch {
    throw new CliError(
      "AUTH",
      "could not save credentials to OS credential storage",
    );
  }
}
/** Remove the default stored authorization. */
export async function clearAuth(): Promise<void> {
  try {
    await (await backend()).deletePassword(SERVICE, ACCOUNT);
  } catch {
    throw new CliError(
      "AUTH",
      "could not remove credentials from OS credential storage",
    );
  }
}
