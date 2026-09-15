Quota Otter is an early Tauri desktop companion for AI account capacity.

- Project/company groups, multi-account dashboard, quota windows, reset countdowns, and tray summaries.
- OpenAI sign-in through the official native Codex app server, using isolated profiles and the OS credential store. Install the native Codex CLI first.
- Claude Code status-line feed for automatic usage observations while Claude Code is active; requires Node.js and supported Claude Code/plan versions. Direct independent Anthropic OAuth polling is not included.
- Manual readings, stale-data handling, local settings, and setup import/export.

macOS is a universal Intel/Apple Silicon build. Windows and Linux builds are x86-64. The initial macOS and Windows installers are unsigned and macOS is not notarized. Live sign-in and native tray behavior require testing on your machine.

Once the Homebrew tap updater has published the cask:

```sh
brew tap panbanda/brews
brew install --cask --no-quarantine quota-otter
```

The app is unsigned and not notarized by Apple, so `--no-quarantine` is required or macOS will refuse to launch it as "damaged." If a copy was already installed without the flag: `xattr -dr com.apple.quarantine "/Applications/Quota Otter.app"`.

No automatic account switching, reset redemption, or cloud credential sync is included.
