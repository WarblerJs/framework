# Security Policy

WarblerJS treats security as an architecture boundary, not a post-release add-on.

## Supported Versions

| Version | Support status |
| --- | --- |
| `0.1.0-rc.x` | Release Candidate security review |
| Stable current major | Security fixes according to [docs/LTS_POLICY.md](./docs/LTS_POLICY.md) |

## Reporting Vulnerabilities

Use GitHub private vulnerability reporting for this repository when it is enabled by the project owner.

If private vulnerability reporting is not enabled, public publication remains blocked until the project owner provides an approved private disclosure channel.

Do not include secrets, credentials, private keys, production data, or exploit payloads beyond the minimum reproduction required for triage.

## Triage Workflow

1. Acknowledge the report through the approved private channel.
2. Classify affected packages and supported release lines.
3. Reproduce without retaining secrets or production data.
4. Prepare the smallest compatible fix.
5. Add permanent regression coverage.
6. Run `bun run verify` and affected security suites.
7. Prepare advisory, changelog, and release notes.
8. Publish the patch according to the supported release line.

## Security Review Scope

Security review covers:

- Core package boundaries and immutable public contracts.
- Compiler non-execution guarantees.
- Runtime conformance, cancellation, and artifact immutability.
- HTTP header, cookie, redirect, upload, limits, timeout, diagnostics, and error-response hardening.
- Playground public API boundaries.

## Verification

Run:

```sh
bun run verify
bun run test:security
```

Security fixes must include permanent regression coverage.

Security policy maintenance follows [docs/MAINTENANCE.md](./docs/MAINTENANCE.md).
