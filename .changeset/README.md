# Changesets

Every change to a package under `packages/` that a consumer could notice
comes with a changeset: a short markdown file in this folder saying which
packages change, by how much (patch, minor, major) and why, written for the
developer who reads the changelog. Make one with:

```sh
npm run changeset
```

Publishing to npm is not switched on yet (a package's
release is a tarball on a GitHub release for now, made by the tag
`<package>@<version>`, `.github/workflows/tarball.yml`). When it is, the release workflow
(`.github/workflows/release.yml`) collects pending
changesets into a "Version Packages" pull request; merging that PR bumps the
versions, writes the changelogs and publishes to npm. The site itself is
not versioned or published, so it is listed under `ignore` in `config.json`.
