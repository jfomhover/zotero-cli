# Zotero CLI Specification

## API Contract

- Provider: Zotero Web API v3 at `https://api.zotero.org`.
- Every request sends `Zotero-API-Version: 3` and uses `Zotero-API-Key` when a key is configured. Public reads may omit the key; `/keys/<key>` requires the key value in the path and must be treated as sensitive in transport diagnostics.
- Personal library paths are `/users/<userId>`; group paths are `/groups/<groupId>`.
- User IDs are numeric and are not usernames. `ZOTERO_USER_ID` is preferred; `ZOTERO_USERNAME` is accepted only as a configuration label and cannot replace the numeric ID. The key identity endpoint `/keys/<key>` discovers the account user ID.
- Only documented GET endpoints are exposed. Attachment downloads use `/items/<attachmentKey>/file`; the key must identify an attachment item, not its parent item. The client must not send the API key to a redirected file host. It may follow only HTTPS redirects whose destination host is in an explicit, maintained Zotero file-storage allowlist; otherwise it fails closed.

## Authentication And Secrets

Normal authentication is `zotero auth login`, an OAuth 1.0a flow using a client registered at Zotero. It binds an ephemeral callback only to `127.0.0.1`, validates the callback token and verifier, requests `library_access=1`, `notes_access=0`, `write_access=0`, and `all_groups=read`, and stores the resulting Zotero API key and numeric user ID in the OS credential store through `keytar`. It never displays or logs OAuth tokens. `zotero auth logout` deletes the stored credential.

For CI and read-only verification, credentials may be supplied at runtime through `ZOTERO_KEY` and `ZOTERO_USER_ID`; environment credentials take precedence over the OS store. `--user-id` may be supplied as a non-secret command-line option; there is no `--key` option. `.env` is not loaded implicitly. The opt-in `--env-file PATH` is test/development support only, performs no interpolation, and is less safe than environment injection. The CLI never persists environment credentials or prints authorization headers. A key should have only the personal-library, notes, and group read access required by the requested workflows.

`.env` is ignored by git and `.env.example` contains placeholders only. OAuth client credentials are supplied through `ZOTERO_OAUTH_CLIENT_KEY` and `ZOTERO_OAUTH_CLIENT_SECRET` for `auth login`; they are never bundled or stored by this CLI.

## Command Tree

```text
zotero auth whoami [--format json]
zotero groups list [--limit N] [--start N] [--all]
zotero collections list [--scope user|group] [--library-id ID] [--limit N] [--start N] [--all]
zotero collections get COLLECTION_KEY [--scope ...] [--library-id ID]
zotero items list [--query TEXT] [--item-type TYPE] [--tag TAG] [--collection KEY]
                    [--scope ...] [--library-id ID] [--limit N] [--all] [--start N]
zotero items get ITEM_KEY [--scope ...] [--library-id ID] [--include data,bib,citation]
zotero items children ITEM_KEY [--scope ...] [--library-id ID] [--limit N] [--start N] [--all]
zotero items download ATTACHMENT_KEY [--scope ...] [--library-id ID] [--output PATH] [--force]
zotero fulltext get ATTACHMENT_KEY [--scope ...] [--library-id ID]
zotero tags list [--scope ...] [--library-id ID] [--limit N]
zotero searches list [--scope ...] [--library-id ID] [--limit N] [--start N] [--all]
zotero schema item-types|item-fields|creator-fields
zotero --help|--version
```

`--format human|json`, `--timeout SECONDS` (1-300), and `--no-input` are global options and may precede or follow the command. `--user-id` is a non-secret global identity override. JSON format is available for every command, not only `auth whoami`. `--force` applies only to downloads. All list commands support `--limit`, `--start`, and explicit `--all` with the bounds below.

`--scope user` uses `--user-id` when supplied, otherwise the key owner's library discovered from `/keys/<key>`. A key is required when the owner ID must be discovered or when the target is private. `--scope group` requires the numeric `--library-id`; group names are not accepted or interpolated into URLs. Item, collection, and attachment keys are validated as safe Zotero key segments. Unknown flags, extra positionals, invalid enums, and out-of-range limits are errors before network access.

## Output Contract

Human output is concise and sanitized. `--format json` writes exactly one versioned result object to stdout; all errors and diagnostics go to stderr. List results use `{ "version": 1, "data": [], "pagination": {"total": N, "limit": N, "start": N, "next": N|null, "complete": true} }`; `next` is a numeric start offset when another page is available and `complete` is false when `--all` stops at a configured cap or a later page fails. Single-object results use `{ "version": 1, "data": ... }`. Downloads write bytes to the requested path and report metadata on stderr unless `--format json` is used, in which case the JSON result is stdout and the file remains at the requested path. A failed or cancelled download emits no success JSON and removes its temporary file.

Exit codes: `0` success/help/version, `2` usage or validation, `3` missing/invalid credentials or authorization, `4` not found, `5` rate limit/temporary service failure/timeout, `6` provider or protocol failure, and `130` cancellation. JSON errors use `{version: 1, error: {code, message, retryable?, hint?}}` on stderr.

## Reliability And Safety

- Default request timeout: 30 seconds; configurable only through a bounded `--timeout`.
- Retry at most three total attempts for `408`, `429`, `500`, `502`, `503`, and `504`, honoring capped `Retry-After` and Zotero `Backoff` (which may appear on successful responses), with bounded exponential backoff and jitter and one overall operation deadline. Never retry downloads after writing partial output.
- Default list limit is 25 and maximum page size is 100 for Web API multi-object requests. `--all` is explicit and capped at 100 pages/10,000 records; without `--all`, one page is returned.
- Follow only `rel=next` pagination links whose origin is `https://api.zotero.org`; ignore or reject `rel=alternate` website links. Detect repeated links and preserve partial-result/continuation metadata when `--all` reaches a cap. Validate response JSON shape sufficiently to reject malformed provider responses.
- Download to a temporary sibling file and rename atomically. Refuse an existing output path unless `--force` is explicit. Never derive a local path from a remote filename without sanitizing it.
- Remote strings are stripped of terminal control sequences in human mode. JSON is serialized, not interpolated. Request URLs, including `/keys/<key>`, are redacted from diagnostics; provider bodies and response headers are not copied into errors.
- Abort requests on SIGINT and do not leave partial download files.

## Explicitly Unsupported

Writes, deletes, uploads, OAuth flow, local API, arbitrary export formats, saved-search execution, and sync change feeds are out of v1. Saved-search commands return metadata only; they do not execute searches. Conditional GETs are also out of v1: do not send cache validators, and treat an unexpected `304` as a provider/protocol failure because no persisted response cache exists. The implementation may use documented read endpoints internally but must not expose a write-capable HTTP method.

## Test And Release Requirements

Test URL/path validation, environment loading, redaction, pagination, retries, malformed responses, API errors, output streams, exit codes, cancellation, atomic downloads, installed executable behavior, and package contents. A read-only live smoke test may use local credentials but must not create, update, delete, upload, or revoke anything.
