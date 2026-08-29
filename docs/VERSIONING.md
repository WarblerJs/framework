# Warbler Versioning

Warbler uses lockstep versioning for publishable first-party packages.

The canonical release version is the root `package.json` `version`. A Warbler
release uses one Git tag, `v<version>`, and one GitHub release named
`Warbler v<version>`.

Every publishable `@warblerjs/*` workspace package must use the canonical
version. Local development keeps first-party package references as
`workspace:*`. Release packaging rewrites first-party dependency,
optional-dependency, peer-dependency, and dev-dependency entries to the exact
canonical version before a tarball can be published.

Private workspaces are excluded from npm publication.
