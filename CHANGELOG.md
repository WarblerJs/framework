# Changelog

## [0.5.0] - 2026-08-07

### Added

- PostgreSQL typed migration system.
- Migration history table support.
- Database schema introspection.
- Generated Prisma-like ORM client.

### Changed

- Replaced model-first architecture with migration-first architecture.

### Fixed

- Prevented previously executed migrations from running again.