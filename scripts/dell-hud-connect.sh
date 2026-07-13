#!/bin/bash
# dell-hud-connect.sh — runs on rdfx5 (Pop!_OS Dell laptop)
# Auto-discovers the MacBook server on the network and opens the Stage HUD in fullscreen.
# Restarts automatically if connection drops. Designed for systemd auto-start on boot.
#
# Discovery priority:
#   1. Bonjour/mDNS: RDFX1-macbook-pro.local:3000 (via avahi-browse)
#   2. Common IP scan: 192.168.0.191:3000, 192.168.1.191:3000
#   3. Custom IP range scan (fallback)

PORT=3000
BONJOUR_HOST="RDFX1-macbook-pro.local"
KNOWN_IPS=(
  "192.168.0.191"
  "192.168.1.191"
  "10.0.0.191"
  "172.16.0.191"
)
CHECK_INTERVAL=5
HUD_URL="/hud.html"
CONTROLLER_URL="/"
BROWSER="chromium-browser"
BROWSER_FALLBACK="firefox"

# ── Log with timestamp (to stderr so $() captures cleanly) ──
log() { echo "[$(date '+%H:%M:%S')] $*" >&2; }

# ── Find the server IP ──
find_server() {
  local ip=""

  # Method 1: Bonjour/mDNS (requires avahi-daemon or avahi-utils)
  if command -v avahi-resolve >/dev/null 2>&1; then
    ip=$(avahi-resolve -4n "$BONJOUR_HOST" 2>/dev/null | awk '{print $2}')
    [ -n "$ip" ] && log "Found via Bonjour: $ip" && echo "$ip" && return 0
  elif command -v avahi-browse >/dev/null 2>&1; then
    ip=$(avahi-browse -r -t _http._tcp 2>/dev/null | grep -A5 "$BONJOUR_HOST" | grep "address" | head -1 | awk '{print $NF}' | tr -d '[]')
    [ -n "$ip" ] && log "Found via Bonjour browse: $ip" && echo "$ip" && return 0
  fi

  # Method 2: resolve .local hostname via systemd-resolved
  if command -v resolvectl >/dev/null 2>&1; then
    ip=$(resolvectl query "$BONJOUR_HOST" 2>/dev/null | grep "$BONJOUR_HOST" | awk '{print $2}' | head -1)
    [ -n "$ip" ] && log "Found via systemd-resolved: $ip" && echo "$ip" && return 0
  fi

  # Method 3: Try known IPs
  for tryip in "${KNOWN_IPS[@]}"; do
    if curl -sf --connect-timeout 2 "http://${tryip}:${PORT}/" >/dev/null 2>&1; then
      log "Found at known IP: $tryip"
      echo "$tryip"
      return 0
    fi
  done

  # Method 4: Scan local subnet (slower, last resort)
  local myip=$(ip route get 1 2>/dev/null | grep -oP 'src \K\S+' | head -1)
  if [ -n "$myip" ]; then
    local subnet=$(echo "$myip" | sed 's/\.[0-9]*$/\./')
    log "Scanning subnet ${subnet}0/24 for server..."
    for i in $(seq 1 254); do
      curl -sf --connect-timeout 0.5 "http://${subnet}${i}:${PORT}/" >/dev/null 2>&1 && {
        log "Found at: ${subnet}${i}"
        echo "${subnet}${i}"
        return 0
      }
    done
  fi

  return 1
}

# ── Find a working browser ──
find_browser() {
  for b in "$BROWSER" "$BROWSER_FALLBACK" google-chrome-stable google-chrome; do
    if command -v "$b" >/dev/null 2>&1; then
      echo "$b"
      return 0
    fi
  done
  return 1
}

# ── Kill existing browser instances (clean restart) ──
kill_browser() {
  pkill -f "$BROWSER" 2>/dev/null || true
  pkill -f "$BROWSER_FALLBACK" 2>/dev/null || true
}

# ── Main loop ──
main() {
  log "Dell HUD Connect starting..."
  log "Looking for server: $BONJOUR_HOST:$PORT"

  local last_ip=""
  local browser=""

  while true; do
    local server_ip=$(find_server 2>/dev/null)

    if [ -z "$server_ip" ]; then
      log "Server not found. Retrying in ${CHECK_INTERVAL}s..."
      sleep "$CHECK_INTERVAL"
      continue
    fi

    local hud_url="http://${server_ip}:${PORT}${HUD_URL}"

    if [ "$server_ip" != "$last_ip" ]; then
      log "Server found at $server_ip:$PORT — opening HUD: $hud_url"
      last_ip="$server_ip"

      # Kill old browser
      kill_browser
      sleep 1

      # Find browser
      browser=$(find_browser)
      if [ -z "$browser" ]; then
        log "ERROR: No browser found. Install chromium-browser or firefox."
        sleep 30
        continue
      fi

      # Open HUD in kiosk/fullscreen mode
      if echo "$browser" | grep -q "chrom"; then
        $browser --kiosk --no-first-run --noerrdialogs --disable-infobars \
          --disable-session-crashed-bubble --disable-restore-session-state \
          "$hud_url" &
        log "Opened Chromium in kiosk: $hud_url"
      else
        $browser --kiosk "$hud_url" &
        log "Opened Firefox in kiosk: $hud_url"
      fi

      BROWSER_PID=$!
      log "Browser PID: $BROWSER_PID"

      # Give browser time to start before checking
      sleep 3
    fi

    # Check server is still reachable
    if ! curl -sf --connect-timeout 3 "http://${server_ip}:${PORT}/" >/dev/null 2>&1; then
      log "Server unreachable — will re-discover"
      last_ip=""
      kill_browser
      sleep "$CHECK_INTERVAL"
      continue
    fi

    # Check browser is still running
    if [ -n "$BROWSER_PID" ] && ! kill -0 "$BROWSER_PID" 2>/dev/null; then
      log "Browser exited — reopening"
      last_ip=""  # force reopen
      continue
    fi

    sleep "$CHECK_INTERVAL"
  done
}

main
