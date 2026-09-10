# Zotero CLI Implementation Plan

## Phase 1: Foundation

- Add `package.json`, TypeScript config, strict source layout, executable entry point, build scripts, and `.env.example`.
- Add typed provider models, OAuth configuration/loading, OS credential-store integration, strict argument parsing, stable errors, output serializers, and terminal sanitization.
- Acceptance: `--help`, `--version`, invalid arguments, and missing credentials work without network calls.

## Phase 2: Transport

- Implement one HTTPS-only Zotero client with API v3 headers, optional API-key authentication, timeouts, bounded retries with jitter and an overall deadline, `Retry-After`/`Backoff`, origin checks, response parsing, and normalized errors. Redact `/keys/<key>` URLs and all credential-bearing diagnostics.
- Implement `auth login` using Zotero OAuth 1.0a with least-privilege read permissions, a loopback callback, callback validation, and OS-backed storage; implement `auth logout`.
- Implement `/keys/<key>` discovery and library path resolution.
- Acceptance: mocked 200/403/404/408/429/5xx/malformed/timeout cases are classified correctly; an unexpected 304 is a protocol failure; retry timing is bounded; and secrets are absent from diagnostics.

## Phase 3: Read Commands

- Implement `auth whoami`, groups, collections, items, tags, searches, fulltext, and schema commands.
- Implement page-based list pagination and explicit `--all` bounds. Return total, current offset, continuation offset, and completeness state; detect repeated or malformed pagination links and define partial-result behavior.
- Acceptance: each command has help, validation, human output, JSON output, and unit/transport tests.

## Phase 4: PDF Retrieval

- Implement attachment metadata discovery, attachment-only `/file` streaming, HTTPS Zotero file-storage redirect allowlisting without forwarding API keys, safe filename handling, atomic temporary download, overwrite protection, and cancellation cleanup.
- Acceptance: mock binary downloads never leave partial files and never follow an untrusted redirect.

## Phase 5: Verification And Packaging

- Add subprocess tests for stdout/stderr separation, exit codes, arbitrary working directory, and installed package execution.
- Run typecheck, tests, build, npm pack inspection, and optional read-only live smoke tests with `ZOTERO_KEY`.
- Update README with setup, least-privilege key guidance, commands, examples, output/error contracts, and limitations.
- Acceptance: clean artifact contains only intended files and no credentials; specs and docs match executable behavior.

## Review Gates

1. A fresh independent review checks these specs for clarity, scope, security assumptions, and implementability before code changes.
2. A fresh independent review checks the implementation for production bugs, secret exposure, API correctness, and missing tests after implementation.

## Risks And Mitigations

- A Zotero username is not a user ID: discover the numeric ID from `/keys/<key>` and document the distinction.
- File downloads may redirect to Zotero storage: allow only validated HTTPS Zotero origins and never forward API keys to a different origin.
- Large libraries can cause accidental volume: require `--all`, enforce page/record caps, and return continuation metadata.
- Provider response drift: validate core shapes and fail with a safe protocol error rather than guessing.
- Live credentials may have broad permissions: keep the CLI GET-only and verify the key's permissions before any smoke test.
