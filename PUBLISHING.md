# GitHub and Homebrew publishing

Target app repository: **panbanda/quota-otter** (public). Existing tap: **panbanda/homebrew-brews**. The install command will be:

```sh
brew tap panbanda/brews
brew install --cask quota-otter
```

It will work only after a successful release and tap update. It is not live yet.

## Bootstrap

On a machine with Git, GitHub CLI (`gh`), and Node.js installed, authenticate `gh` with an account that can create `panbanda/quota-otter` and write workflows to both repositories. Configure your normal Git commit identity. From this extracted directory:

```sh
gh auth login
node scripts/publish-github.mjs
```

The script creates/updates the app repository, pushes a `quota-otter-cask-ci` branch to the tap, and opens a tap PR. It does not create a release tag or bypass failing CI. If the app repo already exists, it must have a history compatible with this source; the script never force pushes.

Alternatively, create the empty app repository in GitHub, enable the connected GitHub app for it, and grant repository contents/workflows write access to both repos. The assistant can then publish the prepared code through that connection. An initial README commit makes it possible to use the connection's commit-based tools.

## Validate and release

1. Let the app repository's **CI** workflow pass on Linux, Windows, and macOS. Check actual OAuth and tray operation on the target systems before promoting a release as production-ready.
2. Merge the tap PR. It adds only the updater workflow/script, without a placeholder cask. The updater checks for releases every six hours and supports **Run workflow** for an immediate update. If the repository has been inactive for an extended period, GitHub can disable scheduled workflows; re-enable/run it when needed.
3. Keep `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` versions aligned. For the first release they are `0.1.0`.
4. Push the release tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

5. **Desktop release** tests and builds all platforms. Only after every matrix job succeeds does it publish a GitHub release containing the five installers plus `SHA256SUMS`. No partial-platform success is published by this workflow. If publication is interrupted, delete/repair the incomplete release through GitHub and rerun the failed job; do not silently replace an already-distributed release.
6. Run **Update Quota Otter cask** in the tap, or wait for its next scheduled run. The script validates the stable version, requires the complete release asset set, downloads the DMG, hashes its bytes, compares the published SHA-256, and creates `Casks/quota-otter.rb`. It does not downgrade or replace the same version.

The tap uses its own `GITHUB_TOKEN`, with contents write permission; **no cross-repository personal token is required**. GitHub Actions must be enabled. If branch protection forbids bot pushes, adapt the updater's commit step to open a pull request and honor the required checks; do not disable protection.

The updater sources in `homebrew-tap/` are the exact files to install into the tap. Later edits to those copies in the app repo do not automatically change the tap; submit a corresponding tap PR.

Initial app bundles are unsigned. For signed releases, add your Apple/Windows signing configuration and secrets using Tauri's documented signing flow, then update the cask caveat. Credentials are never shipped with this source.
