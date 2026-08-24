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
bun run release --dry-run
bun run release
```

The release script discovers publishable packages, builds the internal dependency
graph, resolves workspace ranges into concrete target versions in a temporary
staging manifest, packs and validates tarballs, skips versions already published,
and publishes in topological order. Real publishes require npm authentication and
a clean git working tree. The script does not commit, push, or mutate git history.

Source manifests should keep `workspace:*`, `workspace:^`, or `workspace:~` for
local development. Only staged release manifests are rewritten, so npm consumers
receive regular semver ranges while the monorepo keeps workspace ergonomics.

Useful flags:

```sh
bun run release --dry-run --package @warblerjs/framework
bun run release --dry-run --from @warblerjs/http
bun run release --dry-run --no-tests
bun run release --dry-run --json
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
