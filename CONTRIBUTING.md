# Contributing

WarblerJS is an architecture-first TypeScript framework. Contributions must preserve package boundaries, deterministic behavior, protocol independence, and the public API contracts documented in each package.

## Before Changing Code

1. Read the relevant package documentation under `packages/<package>/docs/current`.
2. Confirm the package owns the responsibility being changed.
3. Prefer the existing implementation style.
4. Keep changes scoped to the smallest package boundary that can own them.
5. Ask for release-owner review before changing public APIs, compiler artifact
   schemas, runtime behavior, package dependency direction, security
   architecture, or release policy.

## Verification

Run the repository gate before submitting release-bound changes:

```sh
bun run typecheck
bun run test
bun run check:versions
bun run check:cli-starter-versions
bun run check:cli-starter-configs
bun run smoke:packages
```

Package-local commands remain supported:

```sh
bun run --cwd packages/core typecheck
bun run --cwd packages/core test
bun run --cwd packages/compiler typecheck
bun run --cwd packages/compiler test
bun run --cwd packages/runtime typecheck
bun run --cwd packages/runtime test
bun run --cwd packages/http typecheck
bun run --cwd packages/http test
```

## Engineering Rules

- Do not introduce runtime discovery, reflection, or decorator-driven behavior.
- Do not import internal package paths from another package.
- Do not bypass public package entry points.
- Do not add framework features in stabilization tasks.
- Do not change public APIs without release-owner review.
- Add tests for every public behavior change.
- Update documentation when release behavior, public API, or package boundaries change.

## Public API Changes

Do not remove stable APIs without release-owner approval, migration notes,
changelog updates, public API test updates, and compatibility review.

## Pull Requests

Every pull request should include:

- Scope summary.
- Verification commands run.
- Public API impact.
- Security impact.
- Performance impact when relevant.
- Documentation impact.
- Compatibility impact.
- Deprecation impact when relevant.

## Release Changes

Release-bound changes should follow [docs/RELEASE.md](./docs/RELEASE.md) and
[docs/VERSIONING.md](./docs/VERSIONING.md).
