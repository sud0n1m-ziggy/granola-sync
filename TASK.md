# GranolaSync — Rewrite in Node.js

Rewrite the Python GranolaSync tool as a Node.js CLI/service. Reference: `granola_sync.py`

## What to build

### 1. `granola_sync.js` — Main sync script
Port from Python. Core logic:
- Read Granola auth token from `~/Library/Application Support/Granola/supabase.json`
  - Parse `workos_tokens` JSON string → extract `access_token`
  - Check expiry: `obtained_at` (ms) + `expires_in` (s) vs now
  - Warn if expired
- Fetch meetings from `https://api.granola.ai/v1/get-documents` (POST, JSON body `{limit: 500}`)
  - Auth header: `Bearer <token>`
- For each meeting, save to `<output_dir>/<meeting_id>/`:
  - `metadata.json` — id, title, created_at, updated_at, attendees (from `people` field), calendar_event
  - `document.json` — full API response
  - `transcript.md` — format transcript panels (type=transcript_panel → speaker + text)
  - `transcript.json` — raw panels
  - `notes.md` — AI summary if available (from `notes` or `summary` field)
- Skip meetings that haven't been updated (compare `updated_at` in existing metadata.json)
- After local sync, optionally rsync to remote machine

### 2. `config.js` — Config loader
- Reads `config.json` (or `config.example.json` as fallback)
- Schema:
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
- Expand `~` in paths

### 3. `install_service.sh` — Update for Node
- Same launchd plist approach but calls `node granola_sync.js --once`
- Keep the existing install_service.sh pattern

### 4. `package.json`
- No external deps needed (use built-in `https`, `fs`, `path`, `child_process`)
- Scripts: `"sync": "node granola_sync.js --once"`, `"start": "node granola_sync.js"`

### CLI
```
node granola_sync.js          # Loop mode (runs every sync_interval_minutes)
node granola_sync.js --once   # Single sync and exit
node granola_sync.js --config path/to/config.json
```

### Logging
- Timestamped output: `[2026-02-15 20:00:00] Fetching meetings...`
- Also append to `granola_sync.log`
- Log: new meetings synced, unchanged count, remote sync status

## Key notes
- Use ONLY Node.js built-ins (no npm dependencies)
- macOS only (reads from ~/Library/Application Support/)
- The remote rsync uses child_process.execSync
- Keep it simple — this is a lightweight sync tool

## Test
- Can't fully test without Granola auth, but make sure the script:
  - Exits gracefully if auth file is missing
  - Handles the --once and --config flags
  - Creates output directory if needed

When completely finished, run:
openclaw system event --text "Done: GranolaSync Node.js rewrite complete" --mode now
