#!/bin/bash
# Install GranolaSync as a macOS launchd service (Node.js version)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.granolasync.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
NODE_BIN="$(command -v node || true)"
CONFIG_PATH="$SCRIPT_DIR/config.json"
LOG_PATH="$SCRIPT_DIR/granola_sync.log"

if [ -z "$NODE_BIN" ]; then
    echo "❌ Node.js not found in PATH. Install Node 18+ first."
    exit 1
fi

# Create config if needed
if [ ! -f "$CONFIG_PATH" ]; then
    if [ -f "$SCRIPT_DIR/config.example.json" ]; then
        cp "$SCRIPT_DIR/config.example.json" "$CONFIG_PATH"
        echo "Created config.json from example. Edit it before starting the service:"
        echo "  $CONFIG_PATH"
    else
        cat <<'EOF' > "$CONFIG_PATH"
{
  "output_dir": "~/granola-meetings",
  "sync_interval_minutes": 60,
  "remote": {
    "enabled": false,
    "host": "",
    "path": "~/granola-meetings",
    "method": "rsync"
  }
}
EOF
        echo "Created default config.json. Edit it before starting the service:"
        echo "  $CONFIG_PATH"
    fi
fi

# Create launchd plist
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.granolasync</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$SCRIPT_DIR/granola_sync.js</string>
        <string>--once</string>
        <string>--config</string>
        <string>$CONFIG_PATH</string>
    </array>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_PATH</string>
    <key>StandardErrorPath</key>
    <string>$LOG_PATH</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF

# Load the service
launchctl bootout gui/$(id -u) "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$PLIST_PATH"

cat <<EOF
✅ GranolaSync service installed!
   Plist: $PLIST_PATH
   Config: $CONFIG_PATH
   Log: $LOG_PATH

   Runs every hour and on login.
   Edit config.json to configure output + remote sync.

   Manage:
     launchctl list | grep granolasync
     launchctl kickstart -k gui/\$(id -u)/com.granolasync
     launchctl bootout gui/\$(id -u) $PLIST_PATH
EOF
