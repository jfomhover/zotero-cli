import { CliError, safeMessage } from "./errors.js";
import type { Config } from "./config.js";

const API_ORIGIN = "https://api.zotero.org";
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const FILE_HOSTS = new Set([
  "api.zotero.org",
  "files.zotero.net",
  "files.zotero.org",
  "storage.zotero.org",
]);

/** Stable page envelope returned by list operations. */
export interface Page<T> {
  data: T[];
  total: number;
  limit: number;
  start: number;
  next: number | null;
  complete: boolean;
}

function headerNumber(headers: Headers, name: string): number | undefined {
  const value = Number(headers.get(name));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function retrySeconds(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
  return undefined;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function nextStart(headers: Headers): number | null {
  const link = headers.get("link");
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (!match) continue;
    const url = new URL(match[1]);
    if (url.origin !== API_ORIGIN)
      throw new CliError(
        "PROVIDER",
        "refusing pagination link outside the Zotero API origin",
      );
    const start = Number(url.searchParams.get("start"));
    if (!Number.isInteger(start) || start < 0)
      throw new CliError(
        "PROVIDER",
        "Zotero returned an invalid pagination link",
      );
    return start;
  }
  return null;
}

/** Typed, bounded transport for read-only Zotero API v3 requests. */
export class ZoteroClient {
  constructor(
    private readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    path: string,
    init: RequestInit = {},
    binary = false,
  ): Promise<{ response: Response; body: unknown }> {
    if (!path.startsWith("/")) throw new CliError("USAGE", "invalid API path");
    const url = new URL(path, API_ORIGIN);
    const headers = new Headers(init.headers);
    headers.set("Zotero-API-Version", "3");
    headers.set(
      "Accept",
      binary ? "application/octet-stream" : "application/json",
    );
    if (this.config.key) headers.set("Zotero-API-Key", this.config.key);
    let lastError: unknown;
    const deadline = Date.now() + this.config.timeoutMs;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new CliError(
          "TEMPORARY",
          "Zotero request timed out",
          true,
          "Try a larger --timeout value.",
        );
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.min(this.config.timeoutMs, remaining),
      );
      const onInterrupt = () => controller.abort();
      process.once("SIGINT", onInterrupt);
      try {
        let response = await this.fetcher(url, {
          ...init,
          headers,
          signal: controller.signal,
          redirect: "manual",
        });
        if (binary && response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location)
            throw new CliError(
              "PROVIDER",
              "Zotero returned a redirect without a location",
            );
          const target = new URL(location, url);
          if (target.protocol !== "https:" || !FILE_HOSTS.has(target.hostname))
            throw new CliError(
              "PROVIDER",
              "refusing attachment redirect to an untrusted host",
            );
          const redirectedHeaders = new Headers(headers);
          redirectedHeaders.delete("Zotero-API-Key");
          response = await this.fetcher(target, {
            method: "GET",
            headers: redirectedHeaders,
            signal: controller.signal,
            redirect: "error",
          });
        }
        clearTimeout(timer);
        const backoff = headerNumber(response.headers, "backoff");
        if (backoff !== undefined) {
          const wait = Math.min(backoff, 30) * 1000;
          if (Date.now() + wait >= deadline)
            throw new CliError(
              "TEMPORARY",
              "Zotero request timed out during backoff",
              true,
            );
          await delay(wait, controller.signal);
        }
        if (response.status === 304)
          throw new CliError(
            "PROVIDER",
            "unexpected not-modified response without a local cache",
          );
        if (response.ok) {
          process.removeListener("SIGINT", onInterrupt);
          if (binary) return { response, body: undefined };
          try {
            return { response, body: await response.json() };
          } catch {
            throw new CliError("PROVIDER", "Zotero returned malformed JSON");
          }
        }
        const retryAfter = retrySeconds(response.headers, "retry-after");
        if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES - 1) {
          const retryDelay =
            Math.min((retryAfter ?? 2 ** attempt) * 1000, 30000) +
            Math.floor(Math.random() * 100);
          if (Date.now() + retryDelay >= deadline)
            throw new CliError(
              "TEMPORARY",
              "Zotero request timed out while retrying",
              true,
            );
          await delay(retryDelay, controller.signal);
          process.removeListener("SIGINT", onInterrupt);
          continue;
        }
        process.removeListener("SIGINT", onInterrupt);
        const code =
          response.status === 401 || response.status === 403
            ? "AUTH"
            : response.status === 404
              ? "NOT_FOUND"
              : RETRY_STATUSES.has(response.status)
                ? "TEMPORARY"
                : "PROVIDER";
        throw new CliError(
          code,
          `Zotero API request failed (${response.status})`,
          code === "TEMPORARY",
        );
      } catch (error) {
        clearTimeout(timer);
        process.removeListener("SIGINT", onInterrupt);
        if (error instanceof CliError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          if (!timedOut) throw new CliError("CANCELLED", "operation cancelled");
          if (attempt < MAX_RETRIES - 1) continue;
          throw new CliError(
            "TEMPORARY",
            "Zotero request timed out",
            true,
            "Try a larger --timeout value.",
          );
        }
        lastError = error;
        const retryDelay = 2 ** attempt * 250;
        if (attempt < MAX_RETRIES - 1 && Date.now() + retryDelay < deadline) {
          await delay(retryDelay, controller.signal);
          continue;
        }
        throw new CliError(
          "TEMPORARY",
          `Zotero request failed: ${safeMessage(lastError)}`,
          true,
          "Check network connectivity and try again.",
        );
      }
    }
    throw new CliError("TEMPORARY", "Zotero request failed", true);
  }

  /** Perform a JSON GET and preserve response headers for pagination/integrity checks. */
  async get<T>(path: string): Promise<{ response: Response; body: T }> {
    return (await this.request(path)) as { response: Response; body: T };
  }
  /** Perform a binary GET, following only approved Zotero storage redirects. */
  async getBinary(path: string): Promise<Response> {
    return (await this.request(path, {}, true)).response;
  }

  /** Fetch one page or an explicitly bounded sequence of pages. */
  async page<T>(
    path: string,
    params: URLSearchParams,
    all: boolean,
    maxPages = 100,
  ): Promise<Page<T>> {
    let start = Number(params.get("start") ?? 0);
    const limit = Number(params.get("limit") ?? 25);
    const data: T[] = [];
    let total = 0;
    let next: number | null = start;
    let pages = 0;
    const seen = new Set<number>();
    while (next !== null && pages < (all ? maxPages : 1)) {
      if (seen.has(next))
        throw new CliError(
          "PROVIDER",
          "Zotero returned a repeated pagination link",
        );
      seen.add(next);
      params.set("start", String(next));
      const result = await this.get<T[]>(`${path}?${params}`);
      if (!Array.isArray(result.body))
        throw new CliError(
          "PROVIDER",
          "Zotero returned an invalid list response",
        );
      data.push(...result.body);
      total =
        headerNumber(result.response.headers, "total-results") ?? data.length;
      next = nextStart(result.response.headers);
      pages++;
      start = Number(params.get("start"));
    }
    const capped = all && next !== null && pages >= maxPages;
    return {
      data: data.slice(0, 10000),
      total,
      limit,
      start,
      next,
      complete: !capped && next === null,
    };
  }
}

export function libraryPath(
  scope: string | undefined,
  libraryId: string | undefined,
  config: Config,
  ownerId?: string,
): string {
  if (scope !== undefined && scope !== "user" && scope !== "group")
    throw new CliError("USAGE", "scope must be user or group");
  if (scope === "group") {
    if (!libraryId || !/^\d+$/.test(libraryId))
      throw new CliError("USAGE", "group scope requires numeric --library-id");
    return `/groups/${libraryId}`;
  }
  const id = libraryId ?? config.userId ?? ownerId;
  if (!id || !/^\d+$/.test(id))
    throw new CliError(
      "USAGE",
      "personal scope requires --user-id or a key for identity discovery",
    );
  return `/users/${id}`;
}

export function safeKey(value: string): string {
  if (!/^[A-Z0-9]{1,20}$/.test(value))
    throw new CliError("USAGE", "invalid Zotero key");
  return encodeURIComponent(value);
}

export const API_ORIGIN_VALUE = API_ORIGIN;
