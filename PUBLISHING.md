# Versioning and distribution

Quota Otter follows Higgs and Omen's Release Please workflow. Conventional commits on `main` maintain a release PR with a changelog and semantic version bump. Merging that PR creates a tag such as `quota-otter-v0.1.0` and starts the installer builds in the same workflow.

Release Please updates package.json, package-lock.json, Cargo.toml, the application's Cargo.lock entry, tauri.conf.json, and the displayed UI version together. CI checks consistency, and Codex client identification uses the compiled Cargo package version. Before 1.0, feature commits increment the patch version and breaking changes increment the minor version, matching Higgs's policy.

The release job explicitly dispatches CI for generated release PRs because GitHub's built-in Actions token does not automatically trigger pull-request workflows. Merge a release PR only after those checks pass.

Windows x64, Linux x64 and universal Intel/Apple Silicon macOS installers are built and tested from the release tag. Release Please creates a draft and explicitly creates the tag for checkout. Only when all three builds succeed does CI upload the five installers and SHA256SUMS and publish the draft. The tap also refuses incomplete releases.

The updater in `panbanda/homebrew-brews` checks every six hours, on relevant main-branch changes, and on manual runs. It verifies the downloaded DMG against SHA256SUMS and performs a macOS cask install, architecture/version check, process-launch smoke check, and uninstall before committing the cask. It never downgrades or silently replaces a version. Re-run the updater after a release for immediate publication.

Install a published version with:

```sh
brew tap panbanda/brews
brew install --cask quota-otter
xattr -dr com.apple.quarantine "/Applications/Quota Otter.app"
```

The app is unsigned and not notarized by Apple, so macOS quarantines it on install and refuses to launch it as "damaged" until that flag is cleared. Homebrew removed `--no-quarantine` in 6.0, so clearing the attribute after install is the only remedy short of signing and notarizing.

Upgrade with `brew upgrade --cask quota-otter`; an upgrade re-downloads the DMG, so clear the attribute again afterwards. The cask installs only the app. OpenAI feeds need the Codex CLI (`brew install --cask codex`) and Claude feeds need Node.js (`brew install node`) and Claude Code, each installed and authenticated separately.

A cask cannot clear quarantine on the user's behalf, so that manual step stays until the bundles are signed and notarized. The CI launch smoke check clears the attribute the same way for its ephemeral test installation. Live provider sign-in still requires verification with real accounts.

The tap uses its own repository token; no cross-repository personal token is needed. If repository policy blocks Release Please from opening PRs or the tap bot from pushing, resolve that policy through the normal approval process rather than disabling protection.
