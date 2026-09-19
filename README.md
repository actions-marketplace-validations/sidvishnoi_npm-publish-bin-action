# npm-publish-bin-action

A GitHub Action that publishes prebuilt CLI binaries to npm, without any postinstall scripts. Works with binaries from any toolchain (Go, Rust, Zig, etc.).

**Important:** This only lets you publish your CLI to npm. It does not provide a way to call your native code from JS (no FFI/bindings, only CLI execution).

## Why and How

You built your tool using a native toolchain. But many people want an easier way to install, that is, using `npm` instead of a toolchain-specific package manager.

A common way to ship a prebuilt binary through npm is a package with a `postinstall` script that downloads (or compiles) the right binary for the host machine after install. That script runs arbitrary code on every install, which is why `--ignore-scripts`, lockfile script-blocking, and registries/scanners that flag postinstall hooks have all become more common. Some environments now simply refuse to run postinstall scripts for security reasons.

This GitHub Action avoids `postinstall` entirely. Each platform/arch gets its own npm package containing just that platform's binary, tagged with the `os`/`cpu` (and `libc`) fields npm already understands. The main package lists every platform package as an `optionalDependencies` and npm installs only the one matching the current machine, no script involved. The main package's [bin wrapper](./src/wrapper-template.txt) then execs whichever one npm put on disk. It's the same distribution model esbuild and swc use for their native binaries.

## Example Usage

Pair it with goreleaser (or any tool that attaches binaries to a GitHub release) in a two-job workflow: one job cuts the release, the other runs once its assets exist.

```yaml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  goreleaser:
    steps:
      # ... your existing goreleaser release setup
      - uses: goreleaser/goreleaser-action@v7
        with: { args: release --clean }

  npm:
    needs: goreleaser
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: sidvishnoi/npm-publish-bin-action@main
        with:
          package-name: mytool
          tag: ${{ github.ref_name }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          npm-token: ${{ secrets.NPM_TOKEN }}
```

Above, `goreleaser` builds the binaries and attaches them to the GitHub release created for the pushed tag. The `npm` job then downloads those same assets and publishes them.

Your package/CLI will be available via `npx mytool` (or installable with `npm i -g mytool`), and its native binaries will be published to npm under `@mytool/<os>-<cpu>`.

## Inputs

See [`action.yml`](action.yml) for the full descriptions; here's a summary:

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `package-name` | yes | | Name of the main npm package. |
| `tag` | yes | | Release tag to publish from. |
| `github-token` | yes | | Token used to list and download release assets via `gh release`. |
| `npm-token` | no | none (OIDC) | npm auth token; omit to publish via OIDC trusted publishing instead. |
| `scope` | no | `@<package-name>` | npm scope for the per-platform packages. |
| `bin-name` | no | `package-name` | Executable name, and what asset filenames are expected to mention. |
| `package-json-template` | no | none | Path to a `package.json`-shaped file for fields that don't vary per platform. |
| `readme` | no | repo's `README.md` | README to include in the main package. |
| `license-file` | no | repo's `LICENSE` | LICENSE to include in every package. |
| `registry-url` | no | `https://registry.npmjs.org` | npm registry to publish to. |
| `dry-run` | no | `false` | Run `npm publish --dry-run` for every package instead of publishing. |
| `provenance` | no | `false` | Pass `--provenance` to every `npm publish` call. |

## Notes

No dependency is ever installed at runtime. `action.yml` runs the `.ts` files directly via Node's native TypeScript support. `devDependencies` are for local typechecking and running tests only.

## Caveats

- The npm version is the tag with a leading `v` stripped and used as-is. No semver validation, no pre-release handling.
- The binary is assumed to sit at the archive's top level, named exactly `<bin-name>` (or `<bin-name>.exe` on Windows). A binary nested in a subdirectory or under a different name inside the archive won't be found.
- `os`/`cpu` are detected by tokenizing each asset filename and matching known keywords (`linux`/`darwin`/`macos`/`win32`/..., `amd64`/`x86_64`/`arm64`/...). This covers goreleaser-style names (`mytool_1.2.3_linux_amd64.tar.gz`) and Rust target triples (`mytool-x86_64-unknown-linux-gnu.tar.gz`), but any other naming scheme that doesn't spell out both in a recognizable token won't be detected.
- One `bin-name`, one wrapper entry point per package. There's no support for a package that ships multiple executables.
- **OIDC publishing:** When `npm-token` is not provided, the GitHub Action assumes [trusted publishing](https://docs.npmjs.com/trusted-publishers) via an OIDC token from the workflow run. But to configure trusted publishing, you need the packages to already exist on npm. For the first publish, you need to use `npm-token`.
- `name`, `version`, `bin`, `files`, `optionalDependencies`, `os`, and `cpu` in `package-json-template` are always computed by this GitHub Action and override the template unconditionally; only the remaining fields (`description`, `license`, `repository`, ...) pass through.
- The generated main package's bin wrapper resolves the right platform package via `optionalDependencies`; a consumer installing with `--no-optional` (or a package manager/lockfile that drops platform-specific optional deps) gets a "could not find the binary" error at runtime, not at install time.
