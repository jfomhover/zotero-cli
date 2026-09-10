import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliError, safeMessage } from "./errors.js";

const execFileAsync = promisify(execFile);
const REQUEST_URL = "https://www.zotero.org/oauth/request";
const ACCESS_URL = "https://www.zotero.org/oauth/access";
const AUTHORIZE_URL = "https://www.zotero.org/oauth/authorize";
const SERVICE = "zotero-cli";

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
function signature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret = "",
): string {
  const normalized = Object.entries(params)
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([ak, av], [bk, bv]) =>
      ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const parsed = new URL(url);
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const base = [method.toUpperCase(), encode(baseUrl), encode(normalized)].join(
    "&",
  );
  return createHmac("sha1", `${encode(consumerSecret)}&${encode(tokenSecret)}`)
    .update(base)
    .digest("base64");
}
function oauthParams(
  consumerKey: string,
  token?: string,
): Record<string, string> {
  return {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomBytes(18).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(token ? { oauth_token: token } : {}),
  };
}
function authHeader(params: Record<string, string>): string {
  return `OAuth ${Object.entries(params)
    .filter(([k]) => k.startsWith("oauth_"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encode(k)}="${encode(v)}"`)
    .join(", ")}`;
}
function parseForm(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text)) result[key] = value;
  return result;
}

async function oauthPost(
  url: string,
  consumerKey: string,
  consumerSecret: string,
  extra: Record<string, string>,
  tokenSecret = "",
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const params = { ...oauthParams(consumerKey, extra.oauth_token), ...extra };
  params.oauth_signature = signature(
    "POST",
    url,
    params,
    consumerSecret,
    tokenSecret,
  );
  const bodyParams = Object.fromEntries(
    Object.entries(extra).filter(([key]) => !key.startsWith("oauth_")),
  );
  const timeout = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader(params),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(bodyParams),
      signal: requestSignal,
    });
  } catch (error) {
    if (signal?.aborted)
      throw new CliError("CANCELLED", "OAuth login cancelled");
    throw new CliError(
      "TEMPORARY",
      `OAuth request failed: ${safeMessage(error)}`,
      true,
      "Check network connectivity and try again.",
    );
  }
  if (!response.ok)
    throw new CliError(
      "AUTH",
      `Zotero OAuth request failed (${response.status})`,
    );
  const parsed = parseForm(await response.text());
  if (!parsed.oauth_token || !parsed.oauth_token_secret)
    throw new CliError("AUTH", "Zotero returned an invalid OAuth response");
  return parsed;
}

async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === "win32")
      await execFileAsync(" rundll32.exe".trim(), [
        "url.dll,FileProtocolHandler",
        url,
      ]);
    else if (process.platform === "darwin") await execFileAsync("open", [url]);
    else await execFileAsync("xdg-open", [url]);
  } catch {
    throw new CliError(
      "AUTH",
      "could not open the browser",
      false,
      "Open the Zotero authorization URL in a system browser and retry login.",
    );
  }
}

/** Registered Zotero OAuth application credentials, supplied only for login. */
export interface OAuthCredentials {
  clientKey: string;
  clientSecret: string;
}
/** Minimal persisted identity and API credential returned by Zotero OAuth. */
export interface StoredAuth {
  key: string;
  userId: string;
  username?: string;
  access?: unknown;
}

/** Complete one Zotero OAuth 1.0a browser authorization transaction. */
export async function login(
  credentials: OAuthCredentials,
): Promise<StoredAuth> {
  if (!credentials.clientKey || !credentials.clientSecret)
    throw new CliError(
      "AUTH",
      "OAuth client credentials are required",
      false,
      "Set ZOTERO_OAUTH_CLIENT_KEY and ZOTERO_OAUTH_CLIENT_SECRET for auth login.",
    );
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new CliError("AUTH", "could not create OAuth callback listener");
  }
  const callback = `http://127.0.0.1:${address.port}/callback`;
  const abort = new AbortController();
  const onInterrupt = () => abort.abort();
  process.once("SIGINT", onInterrupt);
  try {
    const request = await oauthPost(
      REQUEST_URL,
      credentials.clientKey,
      credentials.clientSecret,
      { oauth_callback: callback },
      "",
      abort.signal,
    );
    const callbackResult = new Promise<Record<string, string>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new CliError("AUTH", "OAuth authorization timed out")),
          5 * 60 * 1000,
        );
        let settled = false;
        const closeListener = (finish: () => void) => {
          if (!server.listening) {
            finish();
            return;
          }
          server.close(finish);
        };
        const finish = (error?: CliError, value?: Record<string, string>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          closeListener(() => (error ? reject(error) : resolve(value!)));
        };
        abort.signal.addEventListener(
          "abort",
          () => finish(new CliError("CANCELLED", "OAuth login cancelled")),
          { once: true },
        );
        server.on("request", (req, res) => {
          try {
            if (req.method !== "GET" || !req.url)
              throw new CliError("AUTH", "invalid OAuth callback");
            const url = new URL(req.url, callback);
            if (
              req.headers.host !== `127.0.0.1:${address.port}` ||
              url.pathname !== "/callback" ||
              url.hostname !== "127.0.0.1"
            )
              throw new CliError("AUTH", "invalid OAuth callback destination");
            const allowed = new Set([
              "oauth_token",
              "oauth_verifier",
              "oauth_problem",
              "oauth_problem_advice",
            ]);
            const keys = [...url.searchParams.keys()];
            if (
              keys.some((key) => !allowed.has(key)) ||
              new Set(keys).size !== keys.length
            )
              throw new CliError("AUTH", "invalid OAuth callback parameters");
            const token = url.searchParams.get("oauth_token");
            const verifier = url.searchParams.get("oauth_verifier");
            if (url.searchParams.get("oauth_problem"))
              throw new CliError("AUTH", "OAuth authorization was denied");
            if (!token || token !== request.oauth_token || !verifier)
              throw new CliError("AUTH", "invalid OAuth callback state");
            res.writeHead(200, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            });
            res.end("Authorization received. You may close this window.");
            finish(undefined, { token, verifier });
          } catch (error) {
            res.writeHead(400, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            });
            res.end("Authorization failed. Return to the CLI.");
            finish(
              error instanceof CliError
                ? error
                : new CliError("AUTH", "invalid OAuth callback"),
            );
          }
        });
      },
    );
    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.search = new URLSearchParams({
      oauth_token: request.oauth_token,
      name: "zotero-cli",
      library_access: "1",
      notes_access: "0",
      write_access: "0",
      all_groups: "read",
    }).toString();
    process.stderr.write("Opening Zotero authorization in your browser...\n");
    await openBrowser(authorizeUrl.toString());
    const callbackData = await callbackResult;
    const access = await oauthPost(
      ACCESS_URL,
      credentials.clientKey,
      credentials.clientSecret,
      {
        oauth_token: callbackData.token,
        oauth_verifier: callbackData.verifier,
      },
      request.oauth_token_secret,
      abort.signal,
    );
    const userId = access.userID;
    if (!userId || !/^\d+$/.test(userId))
      throw new CliError(
        "AUTH",
        "Zotero OAuth response did not include a valid user ID",
      );
    return {
      key: access.oauth_token_secret,
      userId,
      username: access.username,
    };
  } catch (error) {
    throw error instanceof CliError
      ? error
      : new CliError("AUTH", `OAuth login failed: ${safeMessage(error)}`);
  } finally {
    abort.abort();
    process.removeListener("SIGINT", onInterrupt);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export { SERVICE };
