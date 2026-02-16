# GranolaSync

A macOS-friendly Node.js service that syncs [Granola](https://granola.ai) meeting transcripts to a local directory and (optionally) to a remote machine via rsync/SCP.

## How it works

1. Reads Granola's WorkOS token from `~/Library/Application Support/Granola/supabase.json`
2. Calls Granola's internal API to fetch every meeting (500 max per request)
3. Saves each meeting in a structured directory (metadata, transcript, notes, raw JSON)
4. Optionally mirrors the output directory to a remote host using rsync or scp

## Requirements

- macOS (Granola stores its auth token locally)
- Node.js 18+
- Granola desktop app installed & signed in (token refreshes when you open the app)
- Optional: SSH access to the remote host for rsync/scp

## Setup

```bash
# Clone
git clone https://github.com/sud0n1m-ziggy/granola-sync.git
cd granola-sync

# (Optional) customize config
cp config.example.json config.json
# Edit config.json to set output directory, interval, remote target, etc.
```

No npm dependencies are required; this project only uses Node.js built-ins.

## Configuration

`config.json` (or `config.example.json` as a fallback) drives the sync:

```json
{
  "output_dir": "~/granola-meetings",
  "sync_interval_minutes": 60,
  "remote": {
    "enabled": true,
    "host": "ziggy",
    "path": "~/granola-meetings",
    "method": "rsync"
  }
}
```

- `output_dir` — Local directory for synced meetings (supports `~`)
- `sync_interval_minutes` — Loop interval when running without `--once`
- `remote.enabled` — Run rsync/scp after each sync cycle
- `remote.host` — SSH/Tailscale hostname
- `remote.path` — Destination path on the remote host (supports `~`)
- `remote.method` — `rsync` (default) or `scp`

## CLI usage

```bash
node granola_sync.js            # Loop mode (default interval)
node granola_sync.js --once     # Single sync and exit
node granola_sync.js --config path/to/config.json

# Via npm scripts
npm run sync                    # Same as --once
npm start                       # Same as loop mode
```

### Logging

All output is timestamped and appended to `granola_sync.log` in the project directory. Errors (missing token, API failures, etc.) also land there.

## Run as a launchd service

```bash
./install_service.sh
```

The installer:

- Ensures `config.json` exists (copies from the example if needed)
- Writes `~/Library/LaunchAgents/com.granolasync.plist`
- Configures launchd to run `node granola_sync.js --once --config ~/.../config.json` every hour and on login

Manage the service:

```bash
launchctl list | grep granolasync
launchctl kickstart -k gui/$(id -u)/com.granolasync
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.granolasync.plist
```

## Output structure

```
~/granola-meetings/
  {meeting-id}/
    metadata.json    # id, title, timestamps, attendees, calendar event
    document.json    # full API response
    transcript.md    # formatted transcript panels
    transcript.json  # raw transcript panels
    notes.md         # AI-generated summary (when available)
```

Meetings that have not changed (`updated_at` untouched) are skipped on subsequent runs.

## Token expiry

Granola tokens expire roughly every 6 hours. If the sync logs a warning about an expired token, simply open the Granola desktop app to refresh the WorkOS token.

## License

MIT
