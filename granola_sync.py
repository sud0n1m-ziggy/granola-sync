#!/usr/bin/env python3
"""
GranolaSync — Sync Granola meeting transcripts to a local directory
and optionally rsync to a remote machine.

Usage:
    python3 granola_sync.py                  # Use default config
    python3 granola_sync.py --config my.json # Custom config
    python3 granola_sync.py --once           # Single sync, no loop
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

# Paths
SUPABASE_PATH = Path.home() / "Library/Application Support/Granola/supabase.json"
DEFAULT_CONFIG = Path(__file__).parent / "config.json"
DEFAULT_OUTPUT = Path.home() / "granola-meetings"
API_BASE = "https://api.granola.ai/v1"
LOG_FILE = Path(__file__).parent / "granola_sync.log"


def log(msg):
    """Log with timestamp."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_config(config_path=None):
    """Load configuration."""
    path = Path(config_path) if config_path else DEFAULT_CONFIG
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {
        "output_dir": str(DEFAULT_OUTPUT),
        "sync_interval_minutes": 60,
        "remote": {"enabled": False},
    }


def get_token():
    """Get access token from Granola's local auth file."""
    if not SUPABASE_PATH.exists():
        log(f"ERROR: Auth file not found at {SUPABASE_PATH}")
        log("Make sure Granola is installed and you're signed in.")
        return None

    with open(SUPABASE_PATH) as f:
        data = json.load(f)

    tokens = json.loads(data.get("workos_tokens", "{}"))
    token = tokens.get("access_token")

    if not token:
        log("ERROR: No access token found. Try signing into Granola again.")
        return None

    # Check expiration
    obtained_at = tokens.get("obtained_at", 0) / 1000
    expires_in = tokens.get("expires_in", 0)
    if datetime.now().timestamp() > obtained_at + expires_in:
        log("WARNING: Token may be expired. Open Granola to refresh.")

    return token


def fetch_documents(token, limit=500):
    """Fetch all documents from Granola."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    response = requests.post(
        f"{API_BASE}/get-documents",
        headers=headers,
        json={"limit": limit},
    )
    response.raise_for_status()
    return response.json()


def fetch_document_metadata(token, doc_id):
    """Fetch detailed metadata for a document."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    response = requests.post(
        f"{API_BASE}/get-document-metadata",
        headers=headers,
        json={"document_id": doc_id},
    )
    response.raise_for_status()
    return response.json()


def format_transcript(panels):
    """Convert transcript panels to readable markdown."""
    lines = []
    for panel in panels:
        if panel.get("type") == "transcript_panel":
            children = panel.get("children", [])
            for child in children:
                speaker = child.get("speaker", "Unknown")
                text_parts = child.get("children", [])
                text = " ".join(p.get("text", "") for p in text_parts if "text" in p)
                if text.strip():
                    lines.append(f"**{speaker}:** {text.strip()}")
                    lines.append("")
    return "\n".join(lines)


def save_meeting(output_dir, doc, metadata=None):
    """Save a meeting to the output directory."""
    doc_id = doc.get("id", "unknown")
    meeting_dir = output_dir / doc_id
    meeting_dir.mkdir(parents=True, exist_ok=True)

    # Check if already synced (and not updated)
    meta_file = meeting_dir / "metadata.json"
    if meta_file.exists():
        existing = json.load(open(meta_file))
        if existing.get("updated_at") == doc.get("updated_at"):
            return False  # Already up to date

    # Save metadata
    meta = {
        "id": doc_id,
        "title": doc.get("title", "Untitled"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "attendees": doc.get("people", []),
        "calendar_event": doc.get("calendar_event"),
    }
    with open(meta_file, "w") as f:
        json.dump(meta, f, indent=2)

    # Save full document
    with open(meeting_dir / "document.json", "w") as f:
        json.dump(doc, f, indent=2)

    # Save transcript
    content = doc.get("content", {})
    panels = content.get("children", []) if isinstance(content, dict) else []
    transcript_md = format_transcript(panels)
    if transcript_md.strip():
        with open(meeting_dir / "transcript.md", "w") as f:
            f.write(f"# {meta['title']}\n")
            f.write(f"*{meta.get('created_at', 'Unknown date')}*\n\n")
            f.write(transcript_md)

        with open(meeting_dir / "transcript.json", "w") as f:
            json.dump(panels, f, indent=2)

    # Save notes/summary if available
    notes = doc.get("notes") or doc.get("summary")
    if notes:
        with open(meeting_dir / "notes.md", "w") as f:
            f.write(f"# Notes: {meta['title']}\n\n")
            if isinstance(notes, str):
                f.write(notes)
            elif isinstance(notes, dict):
                f.write(json.dumps(notes, indent=2))

    return True


def rsync_to_remote(config, output_dir):
    """Rsync meetings to a remote machine."""
    remote = config.get("remote", {})
    if not remote.get("enabled"):
        return

    host = remote.get("host")
    path = remote.get("path", "~/granola-meetings")
    method = remote.get("method", "rsync")

    if method == "rsync":
        cmd = [
            "rsync", "-avz", "--delete",
            str(output_dir) + "/",
            f"{host}:{path}/",
        ]
    else:  # scp
        cmd = ["scp", "-r", str(output_dir) + "/", f"{host}:{path}/"]

    log(f"Syncing to {host}:{path} via {method}...")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode == 0:
            log(f"Remote sync complete.")
        else:
            log(f"Remote sync failed: {result.stderr}")
    except subprocess.TimeoutExpired:
        log("Remote sync timed out after 120s")
    except Exception as e:
        log(f"Remote sync error: {e}")


def sync(config):
    """Run a single sync cycle."""
    token = get_token()
    if not token:
        return

    output_dir = Path(config.get("output_dir", str(DEFAULT_OUTPUT))).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    log("Fetching meetings from Granola...")
    try:
        docs = fetch_documents(token)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 401:
            log("ERROR: Unauthorized. Token expired — open Granola to refresh.")
        else:
            log(f"ERROR: API request failed: {e}")
        return
    except Exception as e:
        log(f"ERROR: {e}")
        return

    documents = docs if isinstance(docs, list) else docs.get("documents", [])
    log(f"Found {len(documents)} meetings")

    new_count = 0
    updated_count = 0

    for doc in documents:
        was_new = save_meeting(output_dir, doc)
        if was_new:
            title = doc.get("title", "Untitled")
            log(f"  {'NEW' if was_new else 'UPDATED'}: {title}")
            new_count += 1

    log(f"Sync complete: {new_count} new/updated, {len(documents) - new_count} unchanged")

    # Remote sync
    rsync_to_remote(config, output_dir)


def main():
    parser = argparse.ArgumentParser(description="GranolaSync — Sync Granola meetings")
    parser.add_argument("--config", help="Path to config file")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    args = parser.parse_args()

    config = load_config(args.config)
    interval = config.get("sync_interval_minutes", 60)

    log("GranolaSync starting...")
    log(f"Output: {config.get('output_dir', DEFAULT_OUTPUT)}")
    log(f"Remote: {'enabled' if config.get('remote', {}).get('enabled') else 'disabled'}")

    if args.once:
        sync(config)
        return

    # Loop mode
    log(f"Running every {interval} minutes (Ctrl+C to stop)")
    while True:
        try:
            sync(config)
            time.sleep(interval * 60)
        except KeyboardInterrupt:
            log("Stopped.")
            break
        except Exception as e:
            log(f"Error: {e}")
            time.sleep(60)  # Wait a minute on error


if __name__ == "__main__":
    main()
