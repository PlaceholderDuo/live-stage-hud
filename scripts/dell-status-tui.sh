#!/bin/bash
# dell-status-tui.sh — RDFX5 Dell Inspiron Live Rig Monitor
# Retro BIOS-inspired TUI, ASCII-only, flicker-free atomic render.

export LC_ALL=C.UTF-8
export LANG=C.UTF-8

BONJOUR_HOST="RDFX1-macbook-pro.local"
PORT=3000
KNOWN_IPS=("192.168.0.191" "192.168.1.191" "192.168.1.102" "10.0.0.191" "172.16.0.191")
CHECK_INTERVAL=3
MEDIA_MOUNT="/mnt/media"

ESC=$(printf '\033')
CLS="${ESC}[2J${ESC}[H"
HIDE="${ESC}[?25l"
BOLD="${ESC}[1m"; DIM="${ESC}[2m"; RESET="${ESC}[0m"; INVERSE="${ESC}[7m"
BLACK="${ESC}[30m"; RED="${ESC}[31m"; GREEN="${ESC}[32m"; YELLOW="${ESC}[33m"
CYAN="${ESC}[36m"; WHITE="${ESC}[37m"

# ── Helpers ─────────────────────────────────────────
repeat() { printf "%*s" "$1" "" | tr ' ' "$2"; }

# Draw an ASCII box, return as string
box() {
  local t=$1 l=$2 w=$3 h=$4
  local inner=$((w - 2)); local hline; printf -v hline '%s' "$(repeat $inner '-')"
  local out="${ESC}[${t};${l}H+${hline}+"
  local r
  for ((r=1; r<=h-2; r++)); do
    out="${out}${ESC}[$((t+r));${l}H|${ESC}[$((t+r));$((l+w-1))H|"
  done
  out="${out}${ESC}[$((t+h-1));${l}H+${hline}+"
  printf '%s' "$out"
}

# Position + print text, return as string
txt() { printf "${ESC}[$1;${2}H%s${ESC}[0K" "$3"; }

# Inversed header/footer bar — uses terminal's default fg (orange #ff8800) as bg
inv_bar() {
  local row=$1 label=$2 w=$3
  printf "${ESC}[${row};1H${INVERSE}  %-*s${RESET}" "$((w-2))" "$label"
}

# ── Data getters ────────────────────────────────────
get_wifi() { iwgetid -r 2>/dev/null || iw dev 2>/dev/null | grep ssid | head -1 | awk '{print $2}' || echo "N/A"; }
get_my_ip() { ip route get 1 2>/dev/null | grep -oP 'src \K\S+' | head -1 || echo "N/A"; }
get_cpu_pct() {
  local idle1 total1 idle2 total2
  read cpu user nice system idle iowait irq softirq steal guest < /proc/stat
  idle1=$idle; total1=$((user + nice + system + idle + iowait + irq + softirq + steal))
  sleep 0.3
  read cpu user nice system idle iowait irq softirq steal guest < /proc/stat
  idle2=$idle; total2=$((user + nice + system + idle + iowait + irq + softirq + steal))
  echo $(( 100 - ( 100 * (idle2 - idle1) / (total2 - total1) ) ))
}
get_temp_c() {
  local t=$(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head -1 | awk '{printf "%.0f", $1/1000}')
  echo "${t:-N/A}"
}
get_ram() {
  local total_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  local avail_kb=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
  local used_mb=$(( (total_kb - avail_kb) / 1024 ))
  local total_mb=$(( total_kb / 1024 ))
  local pct=0
  [ "$total_mb" -gt 0 ] && pct=$(( 100 * used_mb / total_mb ))
  [ "$pct" -lt 0 ] && pct=0
  [ "$pct" -gt 100 ] && pct=100
  printf "%sMB/%sMB (%s%%)" "$used_mb" "$total_mb" "$pct"
}
get_disk_root() { df -h / 2>/dev/null | tail -1 | awk '{print $3 "/" $2 " (" $5 ")"}'; }
get_disk_media() {
  mountpoint -q "$MEDIA_MOUNT" 2>/dev/null && df -h "$MEDIA_MOUNT" 2>/dev/null | tail -1 | awk '{print $3 "/" $2 " (" $5 ")"}' || echo "not mounted"
}
get_load() { cut -d' ' -f1-3 /proc/loadavg; }

# ── Network (cached) ────────────────────────────────
LAST_INET_CHECK=0; LAST_INET_RESULT=""
get_internet_status() {
  local now=$(date +%s)
  [ $((now - LAST_INET_CHECK)) -lt 10 ] && [ -n "$LAST_INET_RESULT" ] && { echo "$LAST_INET_RESULT"; return; }
  LAST_INET_CHECK=$now
  ping -c1 -W2 8.8.8.8 >/dev/null 2>&1 && LAST_INET_RESULT="ONLINE" || LAST_INET_RESULT="LOCAL ONLY"
  echo "$LAST_INET_RESULT"
}
SPEED_RESULT_DOWN="--"; SPEED_RESULT_LATENCY="--"; SPEED_RUNNING=false
update_speed_test() {
  $SPEED_RUNNING && return
  local now=$(date +%s)
  local last=$(cat /tmp/dell-speed-ts 2>/dev/null || echo 0)
  [ $((now - last)) -lt 1800 ] && [ "$SPEED_RESULT_DOWN" != "--" ] && return
  echo "$now" > /tmp/dell-speed-ts
  SPEED_RUNNING=true
  (
    local lat=$(ping -c1 -W2 8.8.8.8 2>/dev/null | grep -oP 'time=\K[0-9.]+' || echo "--")
    SPEED_RESULT_LATENCY="${lat}ms"
    local tmpfile="/tmp/speedtest.bin"; local start=$(date +%s%N)
    curl -sf --connect-timeout 5 --max-time 10 -o "$tmpfile" "http://cachefly.cachefly.net/1mb.test" 2>/dev/null
    local end=$(date +%s%N)
    if [ -f "$tmpfile" ] && [ -s "$tmpfile" ]; then
      local size_bytes=$(stat -c%s "$tmpfile" 2>/dev/null || echo "0")
      local duration=$(echo "scale=2; ($end - $start) / 1000000000" | bc 2>/dev/null || echo "1")
      [ "$size_bytes" -gt 0 ] && [ "$duration" != "0" ] && \
        SPEED_RESULT_DOWN="$(echo "scale=0; $size_bytes * 8 / $duration / 1000" | bc 2>/dev/null || echo "--") Kbps"
      rm -f "$tmpfile"
    else
      SPEED_RESULT_DOWN="no net"; rm -f "$tmpfile" 2>/dev/null
    fi
    SPEED_RUNNING=false
  ) &
}

# ── Server discovery ────────────────────────────────
find_server() {
  if command -v avahi-resolve >/dev/null 2>&1; then
    local ip=$(avahi-resolve -4n "$BONJOUR_HOST" 2>/dev/null | awk '{print $2}')
    [ -n "$ip" ] && echo "$ip" && return 0
  fi
  for tryip in "${KNOWN_IPS[@]}"; do
    curl -sf --connect-timeout 2 "http://${tryip}:${PORT}/" >/dev/null 2>&1 && echo "$tryip" && return 0
  done
  local ctr_file="/tmp/dell-scan-ctr"; local ctr=$(cat "$ctr_file" 2>/dev/null || echo 0)
  ctr=$((ctr + 1)); echo "$ctr" > "$ctr_file"
  [ $((ctr % 5)) -ne 0 ] && return 1
  local myip=$(get_my_ip); [ -z "$myip" ] || [ "$myip" = "N/A" ] && return 1
  local subnet=$(echo "$myip" | sed 's/\.[0-9]*$/\./')
  for i in $(seq 1 254); do
    curl -sf --connect-timeout 0.3 "http://${subnet}${i}:${PORT}/" >/dev/null 2>&1 && { echo "${subnet}${i}"; return 0; }
  done
  return 1
}

# ── Firefox launcher ────────────────────────────────
launch_firefox() {
  local server_ip=$1
  pgrep -f "firefox.*hud.html" >/dev/null 2>&1 && return 0
  pkill -9 firefox 2>/dev/null || true; sleep 2
  rm -f ~/.mozilla/firefox/*.default*/lock ~/.mozilla/firefox/*.default*/.parentlock 2>/dev/null || true
  firefox --new-window "http://${server_ip}:${PORT}/hud.html" & disown
  for i in $(seq 1 10); do
    sleep 1
    local wid=$(DISPLAY=:0 xdotool search --onlyvisible --class firefox 2>/dev/null | while read w; do
      local geo=$(DISPLAY=:0 xdotool getwindowgeometry $w 2>/dev/null | grep Geometry | awk '{print $2}')
      local W=$(echo "$geo" | cut -d'x' -f1); local H=$(echo "$geo" | cut -d'x' -f2 | cut -d'+' -f1)
      [ -n "$W" ] && [ "$W" -gt 100 ] && [ "$H" -gt 100 ] && echo "$w" && break
    done)
    [ -n "$wid" ] && { DISPLAY=:0 xdotool windowactivate $wid 2>/dev/null; sleep 0.3; DISPLAY=:0 xdotool key F11 2>/dev/null; return 0; }
  done
}

# ── Main ────────────────────────────────────────────
main() {
  printf "%s%s" "$CLS" "$HIDE"
  local found=false server_ip="" start_time=$(date +%s) firefox_launched=false

  while true; do
    local w=$(tput cols 2>/dev/null || echo 80); local h=$(tput lines 2>/dev/null || echo 24)
    [ $w -lt 70 ] && w=70; [ $h -lt 24 ] && h=24

    # ── Collect all data before rendering ──
    local wifi=$(get_wifi); local myip=$(get_my_ip); local cpu=$(get_cpu_pct)
    local temp_c=$(get_temp_c); local ram=$(get_ram)
    local disk_root=$(get_disk_root); local disk_media=$(get_disk_media)
    local load=$(get_load)
    local inet=$(get_internet_status); local inet_color="${GREEN}"
    [ "$inet" = "LOCAL ONLY" ] && inet_color="${YELLOW}"
    local speed_down="$SPEED_RESULT_DOWN"; local speed_lat="$SPEED_RESULT_LATENCY"
    local elapsed=$(($(date +%s) - start_time))
    local elapsed_fmt="$((elapsed/60))m $((elapsed%60))s"

    # Temp color
    local temp_color="${GREEN}"; local temp_display="${temp_c}C"
    if [ "$temp_c" != "N/A" ]; then
      [ "$temp_c" -ge 70 ] && temp_color="${YELLOW}"
      [ "$temp_c" -ge 85 ] && temp_color="${RED}"
    fi

    if ! $found; then
      local candidate=$(find_server)
      [ -n "$candidate" ] && { server_ip="$candidate"; found=true; }
    fi
    update_speed_test

    # Fetch REAPER state and client count when server found
    local reaper_connected="" reaper_playing="" reaper_song="" client_count=""
    if $found; then
      local state_json=$(curl -sf --connect-timeout 2 "http://${server_ip}:${PORT}/api/state" 2>/dev/null)
      if [ -n "$state_json" ]; then
        reaper_connected=$(echo "$state_json" | grep -oP '"connected":\s*(true|false)' | grep -oP 'true|false')
        reaper_playing=$(echo "$state_json" | grep -oP '"playing":\s*(true|false)' | grep -oP 'true|false')
        reaper_song=$(echo "$state_json" | grep -oP '"currentSong"\s*:\s*"[^"]*"' | grep -oP ':"[^"]*"' | tr -d '":')
      fi
      local clients_json=$(curl -sf --connect-timeout 2 "http://${server_ip}:${PORT}/api/clients" 2>/dev/null)
      [ -n "$clients_json" ] && client_count=$(echo "$clients_json" | grep -oP '"count":\s*\d+' | grep -oP '\d+')
    fi

    local lw=$((w/2 - 1)); local rl=$((lw + 2))

    # Calculate row layout based on available height
    local st=3
    local box_h1=12
    local gap=1
    local syst=$((st + box_h1 + gap))
    local sys_h=$((h - syst - 3))   # leave room for footer
    [ $sys_h -lt 4 ] && sys_h=4
    [ $sys_h -gt 10 ] && sys_h=10
    local ftr=$((syst + sys_h + 1))
    [ $ftr -ge $h ] && ftr=$((h-1))

    local frame=""

    # ── Header ──
    frame+="$(inv_bar 1 " RDFX5 DELL INSPIRON  |  $(date '+%H:%M:%S') " "$w")"

    # ── STATUS box ──
    frame+="$(box $st 1 $lw $box_h1)"
    frame+="$(txt $st 3 "${BOLD}-- STATUS --${RESET}")"
    if $found; then
      frame+="$(txt $((st+1)) 3 "${GREEN}  OK  Server found${RESET}")"
      frame+="$(txt $((st+2)) 3 "  ${CYAN}http://${server_ip}:${PORT}/hud.html${RESET}")"
      if $firefox_launched; then
        frame+="$(txt $((st+3)) 3 "${GREEN}  HUD connected${RESET}")"
      else
        frame+="$(txt $((st+3)) 3 "${YELLOW}  Opening Firefox...${RESET}")"
      fi
      # REAPER state
      local rp_state="${DIM}REAPER${RESET}  ${YELLOW}offline${RESET}"
      if [ "$reaper_connected" = "true" ]; then
        if [ "$reaper_playing" = "true" ]; then
          rp_state="${DIM}REAPER${RESET}  ${GREEN}playing${RESET}"
        else
          rp_state="${DIM}REAPER${RESET}  ${YELLOW}stopped${RESET}"
        fi
        [ -n "$reaper_song" ] && rp_state="${rp_state}  ${CYAN}${reaper_song}${RESET}"
      fi
      frame+="$(txt $((st+5)) 3 "$rp_state")"
      # Client count
      local cc=""
      [ -n "$client_count" ] && cc="${DIM}Clients${RESET} ${CYAN}${client_count}${RESET}"
      [ -n "$cc" ] && frame+="$(txt $((st+6)) 3 "$cc")"
    else
      frame+="$(txt $((st+1)) 3 "${YELLOW}  Searching for server...${RESET}")"
      frame+="$(txt $((st+2)) 3 "  ${DIM}${BONJOUR_HOST}:${PORT}${RESET}")"
      frame+="$(txt $((st+3)) 3 "  ${DIM}Elapsed: ${elapsed_fmt}${RESET}")"
      # Fill remaining rows with blanks (invisible, just visual spacing)
    fi
    frame+="$(txt $((st+box_h1-2)) 3 "${DIM}  Firefox auto-launches on find${RESET}")"

    # ── NETWORK box ──
    local nst=$st
    frame+="$(box $nst $rl $((w-rl)) $box_h1)"
    frame+="$(txt $nst $((rl+2)) "${BOLD}-- NETWORK --${RESET}")"
    frame+="$(txt $((nst+1)) $((rl+2)) "${DIM}WiFi${RESET}    ${CYAN}${wifi}${RESET}")"
    frame+="$(txt $((nst+2)) $((rl+2)) "${DIM}IP${RESET}      ${CYAN}${myip}${RESET}")"
    frame+="$(txt $((nst+3)) $((rl+2)) "${DIM}Host${RESET}    ${BOLD}rdfx5${RESET} (Pop!_OS)")"
    frame+="$(txt $((nst+4)) $((rl+2)) "${DIM}Server${RESET}  ${BONJOUR_HOST}${RESET}")"
    frame+="$(txt $((nst+5)) $((rl+2)) "${DIM}Internet${RESET} ${inet_color}${inet}${RESET}")"
    frame+="$(txt $((nst+6)) $((rl+2)) "${DIM}Speed${RESET}   ${GREEN}${speed_down}${RESET}  ${DIM}${speed_lat}${RESET}")"
    $found && frame+="$(txt $((nst+7)) $((rl+2)) "${DIM}Found${RESET}   ${GREEN}${server_ip}${RESET}")"
    # Gateway / DNS if available
    local gateway=$(ip route show default 2>/dev/null | awk '{print $3}')
    [ -n "$gateway" ] && frame+="$(txt $((nst+8)) $((rl+2)) "${DIM}Gateway${RESET} ${gateway}")"
    # Signal strength if available
    local signal=$(iw dev 2>/dev/null | grep signal | head -1 | awk '{print $2}')
    [ -n "$signal" ] && frame+="$(txt $((nst+9)) $((rl+2)) "${DIM}Signal${RESET}  ${signal} dBm")"

    # ── SYSTEM box ──
    frame+="$(box $syst 1 $((w-1)) $sys_h)"
    frame+="$(txt $syst 3 "${BOLD}-- SYSTEM --${RESET}")"
    frame+="$(txt $((syst+1)) 3 "${DIM}CPU${RESET}  ${BOLD}${cpu}%${RESET}    ${DIM}Temp${RESET} ${temp_color}${temp_display}${RESET}    ${DIM}Load${RESET} ${load}")"
    frame+="$(txt $((syst+2)) 3 "${DIM}RAM${RESET}  ${ram}")"
    frame+="$(txt $((syst+3)) 3 "${DIM}SSD${RESET}  ${disk_root}")"
    frame+="$(txt $((syst+4)) 3 "${DIM}HDD${RESET}  ${disk_media}")"
    frame+="$(txt $((syst+5)) 3 "${DIM}Up${RESET}   ${elapsed_fmt}")"

    # ── Footer ──
    local footer_label=" rdfx5 "
    $found && footer_label+="| server: ${server_ip} " || footer_label+="| searching... "
    footer_label+="| $(date '+%H:%M:%S') "
    frame+="$(inv_bar $ftr "$footer_label" "$w")"

    # ── Output entire frame at once ──
    printf '%s' "$frame"

    # Launch Firefox once — only in live mode
    $found && ! $firefox_launched && {
      local show_mode=$(curl -sf --connect-timeout 2 "http://${server_ip}:3300/api/show-mode" 2>/dev/null | grep -oP '"mode"\s*:\s*"\K[^"]+')
      [ -z "$show_mode" ] && show_mode="live"
      if [ "$show_mode" = "live" ]; then
        launch_firefox "$server_ip"; firefox_launched=true
      fi
    }

    $found && [ $(( $(date +%s) % 30 )) -lt $CHECK_INTERVAL ] && {
      curl -sf --connect-timeout 3 "http://${server_ip}:${PORT}/" >/dev/null 2>&1 || { found=false; firefox_launched=false; server_ip=""; }
    }

    sleep "$CHECK_INTERVAL"
  done
}

main
