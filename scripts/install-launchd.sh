#!/bin/bash
# Install Jarvis as macOS launchd services (auto-start on login).
#
#   com.jarvis.ui     — Next.js frontend + Node WS backend (production build)
#   com.jarvis.vision — Python vision sidecar (camera + OpenRouter Gemini)
#   com.jarvis.voice  — Python voice sidecar (wake word + TTS HTTP)
#
# Each service is independent: if one fails, the others stay up.

set -euo pipefail

JARVIS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/.jarvis/logs"

NODE_PATH="$(which node)"
NPM_PATH="$(which npm)"
PYTHON_PATH="$(pyenv which python3 2>/dev/null || which python3)"

mkdir -p "$LAUNCH_AGENTS" "$LOG_DIR"

build_ui() {
    echo "→ building Next.js production bundle…"
    cd "$JARVIS_DIR"
    "$NPM_PATH" run build
}

write_plist() {
    local label="$1" plist="$2" working_dir="$3" out_log="$4" err_log="$5"
    shift 5
    local args=("$@")

    local args_xml=""
    for a in "${args[@]}"; do
        args_xml+="        <string>$a</string>\n"
    done

    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
$(printf "%b" "$args_xml")    </array>
    <key>WorkingDirectory</key><string>$working_dir</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$(dirname "$NODE_PATH"):$(dirname "$PYTHON_PATH")</string>
        <key>HOME</key><string>$HOME</string>
        <key>NODE_ENV</key><string>production</string>
        <key>JARVIS_BUS_URL</key><string>ws://localhost:3001</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$out_log</string>
    <key>StandardErrorPath</key><string>$err_log</string>
    <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
PLIST
}

reload() {
    local plist="$1"
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load -w "$plist"
}

# 1. UI ----------------------------------------------------------------------
build_ui
UI_PLIST="$LAUNCH_AGENTS/com.jarvis.ui.plist"
write_plist "com.jarvis.ui" "$UI_PLIST" "$JARVIS_DIR" \
    "$LOG_DIR/ui.log" "$LOG_DIR/ui-error.log" \
    "$NPM_PATH" "run" "start:all"
reload "$UI_PLIST"

# 2. Vision ------------------------------------------------------------------
VISION_PLIST="$LAUNCH_AGENTS/com.jarvis.vision.plist"
write_plist "com.jarvis.vision" "$VISION_PLIST" "$JARVIS_DIR" \
    "$LOG_DIR/vision.log" "$LOG_DIR/vision-error.log" \
    "$PYTHON_PATH" "-m" "vision.service"
reload "$VISION_PLIST"

# 3. Voice -------------------------------------------------------------------
VOICE_PLIST="$LAUNCH_AGENTS/com.jarvis.voice.plist"
write_plist "com.jarvis.voice" "$VOICE_PLIST" "$JARVIS_DIR" \
    "$LOG_DIR/voice.log" "$LOG_DIR/voice-error.log" \
    "$PYTHON_PATH" "-m" "voice.service"
reload "$VOICE_PLIST"

echo ""
echo "✓ Jarvis services installed:"
echo "  com.jarvis.ui      → $LOG_DIR/ui.log"
echo "  com.jarvis.vision  → $LOG_DIR/vision.log"
echo "  com.jarvis.voice   → $LOG_DIR/voice.log"
echo ""
echo "Status:    launchctl list | grep jarvis"
echo "Stop one:  launchctl unload ~/Library/LaunchAgents/com.jarvis.<name>.plist"
echo "Restart:   bash scripts/install-launchd.sh"
echo ""
echo "Note: vision/voice need camera & microphone permission. First-run prompts"
echo "must be accepted in System Settings → Privacy & Security."
