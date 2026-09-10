# Zotero CLI Intent

## Vision

`zotero-cli` is a small, installable TypeScript command-line client for retrieving a user's Zotero references, attachments, PDFs, and full-text content. It should be useful at a terminal, in scripts, and as a dependable building block for research agents.

The first release prioritizes excellent read workflows over broad API coverage. A user should be able to authorize the CLI through Zotero OAuth, discover their account and libraries, find a paper, inspect its metadata, and download its attached PDF without writing application code or exposing credentials to shell history.

## Users And Outcomes

Public-library reads may work without a key when a numeric user or group ID is supplied; identity discovery and private-library reads require a key.

- Researchers retrieve citations and papers from a personal or group library.
- Scripts consume stable JSON without parsing terminal prose.
- AI agents discover commands, identifiers, pagination, and errors from help and structured output.
- Operators can diagnose authentication, rate limiting, and API failures without secret leakage.

## Principles

- Read-only by default and in the initial release. No command may mutate Zotero state.
- Secure by construction: HTTPS, least-privilege Zotero OAuth, OS credential storage, no secret logging, and redacted errors. The key-discovery request necessarily contains the key in its `/keys/<key>` path, so request URLs must never be logged.
- Predictable CLI contract: data on stdout, diagnostics on stderr, stable exit codes, strict arguments, and JSON output.
- Small vertical slices: every command maps to documented Zotero API behavior and has process-level verification.
- Bounded work: pagination, retries, downloads, and request timeouts have explicit limits.
- Honest provider boundary: Zotero's API data is untrusted input and is sanitized before human rendering.

## Scope

The v1 CLI exposes account/key identity, groups, collections, items, saved searches, tags, child items, full-text content, item type metadata, and attachment file downloads. It supports personal libraries and group libraries. It does not implement writes, OAuth registration, file uploads, local Zotero API access, streaming sync, or arbitrary API URLs.

## Success Criteria

- `npm install -g @jfomhover/zotero-cli` (or installation from the package artifact) exposes a working `zotero` executable.
- A user can go from credentials to `items list`, `items get`, and `items download` using documented commands.
- JSON output is parseable from stdout and includes pagination metadata where applicable.
- Invalid input fails before network access; API/auth/rate-limit failures have stable exit classes.
- Unit, transport, subprocess, security, build, and package inspection checks pass.
- No credential value appears in source, package contents, logs, errors, or test artifacts.

## Non-Goals

This project is not a synchronization engine, PDF text extraction system, citation manager, OAuth provider, or replacement for the Zotero desktop client. Mutations may be added only after a separate permission and confirmation design.
