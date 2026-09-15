Quota Otter is an early Tauri desktop companion for AI account capacity.

- Project/company groups, multi-account dashboard, quota windows, reset countdowns, and tray summaries.
- OpenAI sign-in through the official native Codex app server, using isolated profiles and the OS credential store. Install the native Codex CLI first.
- Claude Code status-line feed for automatic usage observations while Claude Code is active; requires Node.js and supported Claude Code/plan versions. Direct independent Anthropic OAuth polling is not included.
- Manual readings, stale-data handling, local settings, and setup import/export.

macOS is a universal Intel/Apple Silicon build. Windows and Linux builds are x86-64. The initial macOS and Windows installers are unsigned and macOS is not notarized. Live sign-in and native tray behavior require testing on your machine.

Once the Homebrew tap updater has published the cask:

```sh
brew tap panbanda/brews
brew install --cask quota-otter
xattr -dr com.apple.quarantine "/Applications/Quota Otter.app"
```

The app is unsigned and not notarized by Apple, so macOS quarantines it on install and refuses to launch it as "damaged" until that flag is cleared. Homebrew removed `--no-quarantine` in 6.0, so clearing the attribute after install is the only remedy.

No automatic account switching, reset redemption, or cloud credential sync is included.
