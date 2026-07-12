#!/bin/bash
# Start Cloudflare Tunnel to expose the live stage HUD publicly.
# Guest singers scan a QR code of the public URL to see the synced HUD.
# Run: bash tunnel.sh [port]

PORT="${1:-3000}"
CF_LOG="/tmp/live-hud-tunnel.log"
PUBLIC_DIR="$(dirname "$0")/web/public"
ASSETS_DIR="$PUBLIC_DIR/assets"

mkdir -p "$ASSETS_DIR"

# Kill any existing tunnel
pkill -f "cloudflared tunnel.*$PORT" 2>/dev/null

echo "Starting Cloudflare Tunnel on port $PORT..."
nohup cloudflared tunnel --url "http://127.0.0.1:$PORT" --protocol http2 --no-autoupdate > "$CF_LOG" 2>&1 &

# Wait for tunnel URL
for i in $(seq 1 20); do
  sleep 1
  URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | head -1)
  if [ -n "$URL" ]; then
    echo ""
    echo "Tunnel live at: $URL"
    echo "  HUD:     $URL/hud.html"
    echo "  QR page: $URL/qr.html"
    echo "  Host:    $URL/index.html"
    echo ""

    # Generate QR code pointing to the HUD
    python3 -c "
import qrcode
qr = qrcode.QRCode(box_size=10, border=4)
qr.add_data('$URL/hud')
qr.make(fit=True)
img = qr.make_image(fill_color='black', back_color='white')
img.save('$ASSETS_DIR/qr-hud.png')
print('QR code saved to assets/qr-hud.png')
" 2>/dev/null || echo "WARNING: QR generation failed (install: pip3 install qrcode Pillow)"

    # Save URL to file for other tools
    echo "$URL" > "$ASSETS_DIR/tunnel-url.txt"

    echo ""
    echo "Tunnel PID: $(pgrep -f 'cloudflared tunnel')"
    echo "To stop:  pkill -f 'cloudflared tunnel'"
    exit 0
  fi
done

echo "ERROR: Tunnel failed to start."
tail -5 "$CF_LOG"
exit 1
