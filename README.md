# buildinfos

The Worker behind [buildinfos.pkg.haus](https://buildinfos.pkg.haus): the build
records for every package in the [pkg.haus](https://pkg.haus) archive, and the
source packages they describe.

A `.buildinfo` is dpkg's own record of a build. It names every package installed
in the build environment at its exact version, and the checksums of what came
out. Published beside it are the `.dsc` and source tarballs the build consumed,
and a `.source` naming the upstream repository, tag and resolved commit.

Together they make "built from upstream source at a release tag" checkable by
someone who does not trust us.

## Why its own host

`buildinfo-pool/<initial>/<source>/` is Debian's source-pool layout. apt never
fetches it and no `Release` file references it, so under `apt.pkg.haus` it read
as an archive path while not being one. Debian draws the same line, at
[buildinfos.debian.net](https://buildinfos.debian.net), whose plural this
follows.

It is also its own Worker. `pkghaus-archive` is what answers `apt update`; a
provenance page should not be able to break it.

## Layout

```
buildinfos.pkg.haus/
  buildinfo-pool/          sharded by the source package's first letter
  buildinfo-pool.list      every path, one per line
```

Shards at the root would make the root namespace the alphabet: no room for the
index, no room for a second view later, and a source package starting with a
digit collides with a shard.

Nothing is stored as a rendered page. The root, every directory listing and the
flat index are built from an R2 `LIST` per request, so there is no tree to keep
in sync with the bucket and no deploy that can silently publish an empty site.

## Verifying a package

Everything a rebuild needs is at the same path:

```sh
B=https://buildinfos.pkg.haus/buildinfo-pool/c/croc
curl -fsSLO $B/croc_11.3.6-1_amd64.buildinfo
curl -fsSLO $B/croc_11.3.6-1.dsc
curl -fsSLO $B/croc_11.3.6.orig.tar.gz
curl -fsSLO $B/croc_11.3.6-1.debian.tar.xz
```

Then `verify/rebuild.sh` in [pkghaus/apt](https://github.com/pkghaus/apt), which
carries the container and the procedure. `debrebuild` resolves the recorded
environment from `snapshot.debian.org`, unpacks the `.dsc`, rebuilds and compares
every checksum.

## What these files do not tell you

**Coverage grows by rebuild.** A record appears when a package is next built, so
a package with no directory here has not been rebuilt since publishing started.

**The compiler is named in the source, not the record.** Go and Rust both fetch
their own toolchain, so `Installed-Build-Depends` names the bootstrap
(`golang-go`, `rustup`) while `go.mod`, `rust-toolchain.toml` or `debian/rules`
names what actually ran. Both ship inside the `.dsc`.

## Storage

The objects are written by `scripts/publish-buildinfo.sh` in pkghaus/apt during
an ingest, into the archive's own R2 bucket under a `buildinfos/` prefix. This
Worker holds a read-only binding and never writes.

Records are kept forever; they are a few kilobytes each. Source tarballs are kept
until the bucket approaches its budget, then pruned oldest first, never touching
one a published version still needs.

## Development

```sh
cd worker
npm ci
npm test
```

The tests drive `worker.fetch()` against a fake R2, so the paths they exercise
are the ones the deployed Worker takes.

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## Buy us a coffee?

If you feel like buying us a coffee (or a beer?), donations are welcome:

```
BTC : bc1qq04jnuqqavpccfptmddqjkg7cuspy3new4sxq9
DOGE: DRBkryyau5CMxpBzVmrBAjK6dVdMZSBsuS
ETH : 0x2238A11856428b72E80D70Be8666729497059d95
LTC : MQwXsBrArLRHQzwQZAjJPNrxGS1uNDDKX6
```
