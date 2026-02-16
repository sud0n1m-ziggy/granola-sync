#!/bin/bash
# Install GranolaSync as a macOS launchd service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.granolasync.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
PYTHON=$(which python3)

# Create config if it doesn't exist
if [ ! -f "$SCRIPT_DIR/config.json" ]; then
    cp "$SCRIPT_DIR/config.example.json" "$SCRIPT_DIR/config.json"
    echo "Created config.json from example. Edit it before starting the service."
    echo "  $SCRIPT_DIR/config.json"
fi

# Install dependencies
pip3 install -r "$SCRIPT_DIR/requirements.txt" --quiet

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
        <string>$PYTHON</string>
        <string>$SCRIPT_DIR/granola_sync.py</string>
        <string>--once</string>
        <string>--config</string>
        <string>$SCRIPT_DIR/config.json</string>
    </array>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$SCRIPT_DIR/granola_sync.log</string>
    <key>StandardErrorPath</key>
    <string>$SCRIPT_DIR/granola_sync.log</string>
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

echo "✅ GranolaSync service installed!"
echo "   Plist: $PLIST_PATH"
echo "   Config: $SCRIPT_DIR/config.json"
echo "   Log: $SCRIPT_DIR/granola_sync.log"
echo ""
echo "   Runs every hour and on login."
echo "   Edit config.json to set remote sync target."
echo ""
echo "   Manage:"
echo "     launchctl list | grep granolasync"
echo "     launchctl kickstart -k gui/\$(id -u)/com.granolasync"
echo "     launchctl bootout gui/\$(id -u) $PLIST_PATH"
