# Release Audit

## Scope

This audit covers the TypeScript source, CLI process contract, Zotero transport, OAuth and credential handling, download behavior, tests, npm metadata, package contents, Node.js 24 compatibility, and GitHub Actions CI.

## Findings Addressed

- Clean checkout publishing: `prepack` now builds `dist` before npm packaging, so ignored local build output is not required.
- CLI parser contract: Commander parse errors are converted to the documented usage exit code and JSON error envelope without duplicate stderr output.
- OAuth transport: token exchanges have bounded timeouts and respond to process cancellation; the loopback callback also closes on cancellation.
- API retry behavior: retry and Zotero backoff waits are deadline-aware and abortable.
- Attachment integrity: downloads retrieve attachment metadata and compare a returned `ETag` with the recorded MD5 when both are available.
- Credential-store integrity: stored keychain records are schema-validated before entering configuration.
- Maintainability: exported auth, transport, configuration, and storage surfaces have concise JSDoc contracts; Prettier is enforced in CI.
- Packaging: `.npmignore`, the `files` allowlist, `prepack`, and `npm pack --dry-run` jointly exclude source, tests, specs, credentials, and local tooling.

## Verification

- Node.js `v24.14.1`
- `npm run typecheck`
- `npm run format:check`
- `npm test`
- `npm run pack:check`
- `npm audit --omit=dev`
- Process tests for help, missing credentials, OAuth precondition errors, validation, unknown options, JSON errors, redirects, malformed responses, pagination, and env precedence
- Live read-only identity, item, collection, list, and PDF download checks using the provided runtime API key

No write, delete, upload, or key-revocation request was made.

## Residual Risks

- OAuth 1.0a is provider-specific and does not provide PKCE; the flow is optional and not the recommended demo path.
- OS credential storage depends on the platform backend and optional native `keytar` installation. The CLI fails closed rather than using plaintext fallback storage.
- Live OAuth browser authorization requires a registered Zotero application and was not exercised without client credentials.
- The package has no publish step in CI. Publishing remains an intentional maintainer action after reviewing the package artifact and npm provenance policy.

## Recommendation

The read-only API-key path is release-ready after CI passes on the target repository. OAuth should remain documented as optional until a registered-app end-to-end test is available.
