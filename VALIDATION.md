# Validation record

## Passed locally

- Frontend syntax checks and `npm run build`.
- `npm test`: **20 passing tests** covering quota units, freshness, reset expiry, unavailable data, multiple buckets, group summaries, manual/live separation, setup validation, atomic merging, and credential exclusion.
- The Claude status-line helper was exercised as a real Node subprocess, including quota-only output and preserved observation time on repeated renders.
- `cargo test --manifest-path tests/native/Cargo.toml --locked`: **4 tests** compiling the actual Rust Codex bridge independently of the desktop system libraries. Covers profile path validation, OAuth destination restrictions, JSON-RPC response correlation with intervening notifications, error redaction, and child-process EOF handling.
- Automated Chromium UI exercise: account creation, manual usage editing, snapshot persistence after reload, membership in two groups, group filtering, demo isolation, and narrow-window rendering. No browser JavaScript errors were observed. Screenshot inspected visually.
- Homebrew cask validation and checksum pipeline tests use synthetic installer bytes; no actual release artifact is claimed.
- Release version consistency checked for `quota-otter-v0.1.0`, including npm/Cargo lockfiles and UI metadata.
- Release Please's actual TOML/JSON/generic updaters were exercised against all extra version files; only the application's Cargo.lock version changed.

## Not completed

- Full Tauri compilation/linking and installer execution. Rust was installed successfully, but `cargo check --manifest-path src-tauri/Cargo.toml` stopped at missing Linux `pkg-config`/GTK/WebKit system dependencies. Installing system packages was not permitted in this environment. The three-platform CI is provided to run these checks on properly provisioned runners.
- Actual provider OAuth login, credential-store persistence/isolation, live quota calls, real Claude sessions, and native tray events on each operating system. No user credentials were requested or used in testing.
- Signed/notarized macOS and signed Windows releases.
- A release and Homebrew cask have not yet been published. The release workflow must pass its native builds before producing installers.

The included code is a tested frontend/bridge implementation with unverified native/provider integration, not a production-certified release. CI publication is gated on successful tests and installer builds for all configured platforms.
