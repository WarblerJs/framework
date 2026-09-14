# Security Policy

WarblerJS treats security as an architecture boundary, not a post-release add-on.

## Supported Versions

| Version | Support status |
| --- | --- |
| `0.6.x` | Supported |
| `< 0.6` | Unsupported |

Warbler is currently in the pre-1.0 release series. Security fixes are provided
for the latest published minor release.

## Reporting Vulnerabilities

Do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.

Report vulnerabilities through GitHub Private Vulnerability Reporting in the
repository's **Security** tab.

Private Vulnerability Reporting must be enabled before this repository is made
public. Until it is enabled, public publication remains blocked.

Include:

- The affected Warbler version and package.
- A clear description of the vulnerability.
- Minimal reproduction steps.
- The security impact.
- Any known mitigation.

Do not include unrelated secrets, credentials, private keys, customer data, or
production data.

## Triage Workflow

1. Acknowledge the report through the approved private channel.
2. Classify affected packages and supported release lines.
3. Reproduce without retaining secrets or production data.
4. Prepare the smallest compatible fix.
5. Add permanent regression coverage.
6. Run the affected test suites and release checks that exist for the change.
7. Prepare advisory, changelog, and release notes.
8. Publish the patch according to the supported release line.

## Security Review Scope

Security review covers:

- Compiler analysis and generated bindings.
- Runtime lifecycle and dependency-injection scopes.
- HTTP parsing, limits, security headers, CSRF, cookies, redirects, static
  assets, streaming, and error responses.
- Database query safety, transactions, migrations, row locking, and soft
  deletes.
- WebSocket validation and lifecycle.
- Package publication and supply-chain boundaries.
- Public Web Standard API portability.

## Verification

Security fixes must include permanent regression coverage.
