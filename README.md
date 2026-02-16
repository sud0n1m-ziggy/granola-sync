# GranolaSync

A macOS service that syncs [Granola](https://granola.ai) meeting transcripts to a local directory and optionally to a remote machine via rsync/SSH.

Designed for setups where Granola runs on your laptop but you want transcripts available on a headless server (e.g., an OpenClaw Mac Mini).

## How it works

1. Reads Granola's auth token from `~/Library/Application Support/Granola/supabase.json`
2. Fetches all meetings via Granola's internal API
3. Saves each meeting as structured files (metadata, transcript, notes)
4. Optionally rsyncs the output directory to a remote machine

## Install

```bash
# Clone
git clone https://github.com/sud0n1m-ziggy/granola-sync.git
cd granola-sync

# Install dependencies
pip3 install -r requirements.txt

# Configure
cp config.example.json config.json
# Edit config.json with your settings
```

## Configuration

```json
{
  "output_dir": "~/granola-meetings",
  "sync_interval_minutes": 60,
  "remote": {
    "enabled": false,
    "host": "ziggy",
    "path": "~/granola-meetings",
    "method": "rsync"
  }
}
```

- `output_dir`: Where to save meetings locally
- `sync_interval_minutes`: How often to check for new meetings
- `remote.enabled`: Whether to rsync to a remote machine
- `remote.host`: SSH/Tailscale hostname of the remote machine
- `remote.path`: Destination path on the remote machine
- `remote.method`: `rsync` (default) or `scp`

## Usage

### One-shot sync
```bash
python3 granola_sync.py
```

### Run as a background service (launchd)
```bash
./install_service.sh
```

This installs a launchd plist that runs GranolaSync every hour. The service starts automatically on login.

### Manage the service
```bash
# Check status
launchctl list | grep granolasync

# Stop
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.granolasync.plist

# Restart
launchctl kickstart -k gui/$(id -u)/com.granolasync
```

## Output structure

```
~/granola-meetings/
  {meeting-id}/
    metadata.json    # title, date, attendees, duration
    transcript.md    # formatted transcript
    transcript.json  # raw transcript data
    document.json    # full API response
    notes.md         # AI-generated summary (if available)
```

## Requirements

- macOS (reads Granola's local auth file)
- Python 3.9+
- Granola desktop app installed and signed in
- For remote sync: SSH access to destination (e.g., via Tailscale)

## Token expiry

Granola's auth tokens expire after ~6 hours. The service will warn you if the token is expired. Opening the Granola app refreshes the token automatically.

## License

MIT
