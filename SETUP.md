# GranolaSync — Setup on Your Laptop

Syncthing shares this folder, so everything here is already on both machines.

## Install

On your MacBook, open Terminal and run:

```bash
cd ~/.openclaw/workspace/projects/granola-sync
cp config.example.json config.json
./install_service.sh
```

## Config

Edit `config.json` — set `output_dir` to wherever this folder lives on your laptop + `/meetings`:

```json
{
  "output_dir": "~/.openclaw/workspace/projects/granola-sync/meetings",
  "sync_interval_minutes": 60,
  "remote": {
    "enabled": false
  }
}
```

Syncthing does the rest. Meetings appear in `meetings/` on both machines.

## Test

```bash
node granola_sync.js --once
```

Make sure Granola is open so the auth token is fresh.

## What happens

- Runs every hour via launchd
- Reads Granola auth from `~/Library/Application Support/Granola/supabase.json`
- Saves each meeting to `meetings/<meeting-id>/` (metadata, transcript, notes)
- Syncthing syncs to Ziggy's Mac Mini automatically
- Ziggy can then ingest transcripts into the CRM
