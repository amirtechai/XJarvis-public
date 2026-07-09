#!/bin/bash
# Jarvis health monitor — designed to be run every 5 minutes via cron.
#
# Install:
#   crontab -e
#   */5 * * * * ~/XJarvis/scripts/health_monitor.sh >/dev/null 2>&1
#
# Checks:
#   - backend (HTTP 200 on /api/system-stats)
#   - frontend (HTTP 200 on /dashboard)
#   - vision sidecar (HTTP 200 on :8765/status, optional)
#   - voice sidecar (HTTP 200 on :8766/status, optional)
#   - per-process CPU > 90% sustained for >60s → restart that service
#
# Down or sustained-overload events trigger a macOS desktop notification.

set -u

LOG_DIR="$HOME/.jarvis/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/health.log"
STATE_DIR="$LOG_DIR/health_state"
mkdir -p "$STATE_DIR"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

notify() {
    local msg="$1"
    osascript -e "display notification \"$msg\" with title \"Jarvis Health\"" >/dev/null 2>&1 || true
    log "NOTIFY: $msg"
}

check_http() {
    local name="$1" url="$2" optional="${3:-0}"
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]]; then
        log "OK $name ($url)"
        rm -f "$STATE_DIR/$name.down"
    else
        if [[ "$optional" == "1" ]]; then
            log "SKIP $name (optional, $code)"
            return
        fi
        log "DOWN $name ($url) → $code"
        if [[ ! -f "$STATE_DIR/$name.down" ]]; then
            notify "$name service is down ($code)"
            touch "$STATE_DIR/$name.down"
        fi
    fi
}

check_cpu_overload() {
    local pattern="$1" service_label="$2" cpu_threshold=90
    local cpu_int
    cpu_int="$(ps -A -o %cpu,command | grep -i "$pattern" | grep -v grep | awk '{sum+=$1} END {printf "%d", sum}')"
    [[ -z "$cpu_int" ]] && cpu_int=0

    local marker="$STATE_DIR/$service_label.cpu"
    if (( cpu_int > cpu_threshold )); then
        if [[ -f "$marker" ]]; then
            local prev=$(cat "$marker")
            if (( $(date +%s) - prev > 60 )); then
                log "RESTART $service_label (CPU ${cpu_int}% > 60s)"
                notify "$service_label CPU pegged — restarting"
                if [[ -f "$HOME/Library/LaunchAgents/com.jarvis.$service_label.plist" ]]; then
                    launchctl unload "$HOME/Library/LaunchAgents/com.jarvis.$service_label.plist" 2>/dev/null
                    launchctl load -w "$HOME/Library/LaunchAgents/com.jarvis.$service_label.plist" 2>/dev/null
                fi
                rm -f "$marker"
            fi
        else
            date +%s > "$marker"
        fi
    else
        rm -f "$marker"
    fi
}

# --- Run checks --------------------------------------------------------------
check_http "backend"  "http://localhost:3001/api/system-stats"
check_http "frontend" "http://localhost:3000/dashboard"
check_http "vision"   "http://localhost:8765/status" 1
check_http "voice"    "http://localhost:8766/status" 1

check_cpu_overload "node backend/server.js" "ui"
check_cpu_overload "vision.service"         "vision"
check_cpu_overload "voice.service"          "voice"

# Trim log if oversized
if [[ $(wc -c <"$LOG" 2>/dev/null || echo 0) -gt 1048576 ]]; then
    tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
