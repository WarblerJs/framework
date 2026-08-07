# Changelog

All notable repository-level release changes are recorded here.

This project follows Semantic Versioning as defined in [docs/VERSIONING.md](./docs/VERSIONING.md).

## 1.0.0

Status: Draft, blocked

### Added

- Version 1.0 architecture and production launch audit.
- Version 1.0 release-candidate summary.
- Version 1.0 migration guide.
- Repository-level API reference index.
- Version 1.0 release notes draft.
- Deterministic `bun run release:audit:1.0` audit command.

### Known Limitations

- Stable release is not approved while root `LICENSE` text is missing.
- Stable release is not approved until the private security disclosure channel
  is recorded.
- Stable release is not approved while package versions remain `0.1.0-rc.0`.
- Stable release is not approved until `v1.0.0` is tagged and packages are
  published by a release owner.

## 0.1.0-rc.0

Status: Release Candidate preparation

### Added

- Repository-wide `bun run verify` release gate.
- Repository validation and release validation scripts.
- CI verification workflow for typecheck, tests, benchmarks, and release validation.
- Root release checklist, release notes template, and final release audit.
- Publication metadata for `@warbler/core`, `@warbler/compiler`, `@warbler/runtime`, and `@warbler/http`.

### Changed

- Production package manifests now declare RC version metadata consistently.
- HTTP security and regression suites are callable through package-local scripts.

### Security

- Root security policy documentation was added.
- Existing HTTP security, Runtime conformance, and package-boundary checks are included in the unified gate.

### Known Limitations

- Root legal license text still requires project-owner approval before public publication.
- Published dependency ranges for internal Warbler packages must be converted from local development links during the publication step.
- Controlled CI benchmark baselines are still required before stable release certification.
