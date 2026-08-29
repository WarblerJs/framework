# Warbler Release Workflow

Warbler packages publish under the npm scope `@warblerjs/*`.

- CLI package: `@warblerjs/cli`
- CLI executable: `warbler`
- Public framework façade: `@warblerjs/framework`

The monorepo keeps development-friendly workspace ranges such as `workspace:*`.
Those ranges must never reach npm package metadata. External package managers
cannot resolve monorepo workspace protocols from a published tarball.

Use the canonical release workflow:

```sh
bun run sync:versions --version 0.5.0
bun run release --version 0.5.0 --dry-run
bun run release --version 0.5.0
```

The release script discovers publishable packages, builds the internal dependency
graph, validates that every public `@warblerjs/*` package is on the same
canonical version, resolves first-party package references into exact target
versions in a temporary staging manifest, packs and validates tarballs, rejects
duplicate npm versions, and publishes in topological order. Real publishes
require npm authentication and a clean git working tree.

Source manifests should keep `workspace:*` for local first-party dependencies.
Only staged release manifests are rewritten, so npm consumers receive exact
lockstep dependency versions while the monorepo keeps workspace ergonomics.

Useful flags:

```sh
bun run release --version 0.5.0 --dry-run --no-tests
bun run release --version 0.5.0 --dry-run --json
bun run check:versions
```

After a real release, verify the public metadata and installation path from a
directory outside the monorepo:

```sh
npm view @warblerjs/cli version
npm view @warblerjs/cli dependencies --json
bun install -g @warblerjs/cli
warbler --help
bun add @warblerjs/framework
```
