# Changelog

All notable changes to `@jfomhover/zotero-cli` are documented here.

The project follows [Semantic Versioning](https://semver.org/).

## [0.1.3] - 2026-09-10

### Fixed

- Make `zotero --version` read the published package version instead of using a hardcoded value.

## [0.1.2] - 2026-09-10

### Added

- Add repeatable `--allow-redirect-host` support for documented HTTPS storage hosts.
- Show the blocked redirect origin and path in attachment download errors without exposing signed query parameters.
- Add validation and regression tests for redirect-host overrides.

## [0.1.1] - 2026-09-10

### Fixed

- Allow redirects to Zotero's S3-backed file-storage hostname.
- Add attachment redirect regression coverage.

## [0.1.0] - 2026-09-10

### Added

- Read-only TypeScript CLI for Zotero Web API v3.
- Commands for account identity, groups, collections, items, tags, saved searches, full text, schema metadata, and attachment downloads.
- JSON output, stable exit codes, bounded pagination, retries, timeouts, cancellation, terminal-safe human output, and atomic downloads.
- Optional Zotero OAuth 1.0a login with OS credential-store support.
- Node.js 24 support, npm packaging, GitHub Actions CI, security tests, and release audit documentation.
