# zotero-cli

Read-only CLI for the Zotero Web API v3. Retrieve references, metadata, indexed full text, and attached PDF files without granting the CLI write access.

## Install And Configure

```sh
npm install -g @jfomhover/zotero-cli
```

Create a read-only Zotero API key in your Zotero account settings, then expose it as `ZOTERO_KEY` in the shell running the CLI:

```powershell
$env:ZOTERO_KEY = "your-read-only-api-key"
$env:ZOTERO_USER_ID = "1365069" # optional
```

`ZOTERO_USER_ID` is optional when `ZOTERO_KEY` is set. The CLI discovers the numeric account ID from Zotero when needed. Environment variables are read at runtime and are never persisted by the CLI.

For CI, inject `ZOTERO_KEY` through the CI platform's secret mechanism. For local testing, an ignored env file can be supplied explicitly:

```sh
zotero --env-file .env --format json auth whoami
```

The file is not loaded implicitly and is only a test/development escape hatch. It must contain `ZOTERO_KEY` and optionally numeric `ZOTERO_USER_ID`; do not commit it. A username is not a Zotero user ID. If `ZOTERO_USER_ID` is omitted, the key identity endpoint discovers it.

## Examples

```sh
zotero auth whoami
zotero groups list --format json
zotero items list --query "machine learning" --limit 10 --format json
zotero items get ABCD1234 --format json
zotero items children ABCD1234 --format json
zotero fulltext get ATTACH01 --format json
zotero items download ATTACH01 --output ./paper.pdf
```

Use `--scope group --library-id GROUP_ID` for a group library. List commands return one page by default; use `--all` for a bounded multi-page read. The CLI never executes saved searches, uploads, writes, or deletes.

## OAuth Status

An OAuth 1.0a login flow exists for future use, but it is not the recommended setup path for this release. It requires registering an OAuth application with Zotero. For demos, local development, and CI, use `ZOTERO_KEY`.

## Development

```sh
npm install
npm run typecheck
npm run format:check
npm test
npm run pack:check
```

The package supports Node.js 24 or later. This release intentionally exposes only read operations.
