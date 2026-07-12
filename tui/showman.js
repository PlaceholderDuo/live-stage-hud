#!/usr/bin/env node
// Live Stage HUD — Show Manager TUI
// =================================
// Terminal UI for managing the live performance server:
//   - Start/stop Cloudflare tunnel
//   - Generate QR code for guest singers
//   - Publish redirect URL to GitHub Pages
//   - Show server status
//
// Usage: node showman.js [--port 3000]

const { spawn, execSync, spawnSync } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.argv.includes("--port")
  ? parseInt(process.argv[process.argv.indexOf("--port") + 1]) || 3000
  : 3000;

const PROJECT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(PROJECT_DIR, "web", "public");
const ASSETS_DIR = path.join(PUBLIC_DIR, "assets");
const CF_LOG = "/tmp/live-hud-tunnel.log";
const URL_FILE = path.join(ASSETS_DIR, "tunnel-url.txt");
const QR_FILE = path.join(ASSETS_DIR, "qr-hud.png");

let tunnelPid = null;
let tunnelUrl = null;

// ── Terminal input ──
function clearScreen() { process.stdout.write("\x1b[2J\x1b[H"); }
function bold(s) { return "\x1b[1m" + s + "\x1b[0m"; }
function green(s) { return "\x1b[32m" + s + "\x1b[0m"; }
function red(s) { return "\x1b[31m" + s + "\x1b[0m"; }
function yellow(s) { return "\x1b[33m" + s + "\x1b[0m"; }
function cyan(s) { return "\x1b[36m" + s + "\x1b[0m"; }
function dim(s) { return "\x1b[2m" + s + "\x1b[0m"; }

// ── Server & Tunnel Status ──
function checkServer() {
  try { return execSync(`lsof -i:${PORT} -sTCP:LISTEN -t`, { encoding: "utf-8" }).trim().length > 0; }
  catch { return false; }
}

function checkTunnel() {
  try { return execSync("pgrep -f 'cloudflared tunnel'", { encoding: "utf-8" }).trim().length > 0; }
  catch { return false; }
}

function loadTunnelUrl() {
  if (fs.existsSync(URL_FILE)) return fs.readFileSync(URL_FILE, "utf-8").trim();
  return null;
}

function saveTunnelUrl(url) {
  fs.writeFileSync(URL_FILE, url, "utf-8");
  tunnelUrl = url;
}

// ── Tunnel Management ──
function startTunnel() {
  if (checkTunnel()) return "already running";
  try { fs.writeFileSync(CF_LOG, ""); } catch {}
  const out = fs.openSync(CF_LOG, "a");
  const child = spawn("cloudflared", [
    "tunnel", "--url", `http://127.0.0.1:${PORT}`,
    "--protocol", "http2", "--no-autoupdate"
  ], { detached: true, stdio: ["ignore", out, out] });
  child.unref();
  tunnelPid = child.pid;
  return new Promise((resolve) => {
    let attempts = 0;
    const timer = setInterval(() => {
      try {
        const log = fs.readFileSync(CF_LOG, "utf-8");
        const match = log.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/);
        if (match) { clearInterval(timer); saveTunnelUrl(match[0]); resolve("started"); }
      } catch {}
      if (++attempts > 20) { clearInterval(timer); resolve("timeout"); }
    }, 1000);
  });
}

function stopTunnel() {
  try { execSync("pkill -f 'cloudflared tunnel'"); return "stopped"; }
  catch { return "not running"; }
}

// ── QR Code Generation ──
function generateQR(url) {
  mkdirSafe(ASSETS_DIR);
  try {
    execSync(
      `python3 -c "
import qrcode
qr = qrcode.QRCode(box_size=10, border=4)
qr.add_data('${url}')
qr.make(fit=True)
img = qr.make_image(fill_color='black', back_color='white')
img.save('${QR_FILE}')
"`,
      { encoding: "utf-8", timeout: 5000 }
    );
    return true;
  } catch { return false; }
}

function mkdirSafe(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── GitHub Pages Publish ──
function githubPagesEnabled() {
  return fs.existsSync(path.join(PROJECT_DIR, ".git"))
    && fs.existsSync(path.join(PROJECT_DIR, "gh-pages", "guest.html"));
}

function publishUrl() {
  if (!tunnelUrl) return "No tunnel URL";
  const ghDir = path.join(PROJECT_DIR, "gh-pages");
  mkdirSafe(ghDir);

  // Write redirect page
  const guestHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Guest Singer</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:2rem;text-align:center}
h1{font-size:1.5rem;margin-bottom:1rem}
.spinner{border:4px solid #333;border-top:4px solid #4fc3f7;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:1rem auto}
@keyframes spin{to{transform:rotate(360deg)}}
p{color:#aaa;font-size:.85rem}</style></head>
<body>
<h1>Live Stage Lyrics</h1>
<div class="spinner"></div>
<p>Connecting...</p>
<script>window.location.replace("${tunnelUrl}/hud");</script>
</body></html>`;

  fs.writeFileSync(path.join(ghDir, "guest.html"), guestHtml, "utf-8");
  fs.writeFileSync(path.join(ghDir, "tunnel-url.txt"), tunnelUrl, "utf-8");

  // Try to commit and push
  try { execSync("git add gh-pages/ && git commit -m 'Update tunnel URL' && git push origin main", { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 15000 }); }
  catch { return "git push failed — do 'git push' manually"; }
  return "published";
}

// ── Display ──
function drawHeader() {
  console.log("");
  console.log(bold("╔══════════════════════════════════════════════╗"));
  console.log(bold("║") + "         " + bold("LIVE STAGE HUD — Show Manager") + "        " + bold("║"));
  console.log(bold("║") + "          Terminal Control Interface           " + bold("║"));
  console.log(bold("╚══════════════════════════════════════════════╝"));
  console.log("");
}

function drawStatus() {
  const serverUp = checkServer();
  const tunnelUp = checkTunnel();
  const url = loadTunnelUrl() || tunnelUrl;

  console.log(bold("STATUS"));
  console.log("  Server  : " + (serverUp ? green("RUNNING") + "  (port " + PORT + ")" : red("STOPPED")));
  console.log("  Tunnel  : " + (tunnelUp ? green("LIVE") + "     " + cyan(url || "") : red("STOPPED")));
  console.log("  QR Code : " + (fs.existsSync(QR_FILE) ? green("READY") + "   " + dim(QR_FILE) : red("NONE")));
  console.log("  GitHub  : " + (githubPagesEnabled() ? green("CONFIGURED") : yellow("NOT SET UP")));
  console.log("");
}

function drawQR(url) {
  if (!url) return;
  console.log(bold("GUEST SINGER URL"));
  console.log("  " + cyan(url + "/hud"));
  console.log("  Print QR from: " + dim(url + "/qr.html"));
  console.log("");
}

function drawMenu() {
  console.log(bold("COMMANDS"));
  console.log("  " + green("[1]") + " Start Tunnel          " + red("[2]") + " Stop Tunnel");
  console.log("  " + green("[q]") + " Regenerate QR Code    " + dim("[r] Refresh Status"));
  if (githubPagesEnabled()) console.log("  " + green("[p]") + " Push URL to GitHub    ");
  console.log("  " + dim("[0]") + " Exit");
  console.log("");
  process.stdout.write("  > ");
}

// ── Main Loop ──
async function main() {
  if (!checkServer()) {
    console.log(red("Server is not running on port " + PORT + "!"));
    console.log(dim("Start it with: cd web && node server.js"));
  }

  tunnelUrl = loadTunnelUrl();

  clearScreen();
  drawHeader();
  drawStatus();
  if (tunnelUrl) drawQR(tunnelUrl);
  drawMenu();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", async (line) => {
    const cmd = line.trim().toLowerCase();
    let msg = "";

    clearScreen();
    drawHeader();

    switch (cmd) {
      case "1":
        console.log(dim("Starting tunnel..."));
        msg = await startTunnel();
        console.log(msg === "started" ? green("Tunnel started!") : red("Failed: " + msg));
        if (msg === "started") {
          generateQR(tunnelUrl + "/hud");
          tunnelUrl = loadTunnelUrl();
        }
        break;
      case "2":
        msg = stopTunnel();
        console.log(msg === "stopped" ? yellow("Tunnel stopped.") : dim(msg));
        tunnelUrl = null;
        saveTunnelUrl("");
        break;
      case "q":
        if (tunnelUrl) {
          const ok = generateQR(tunnelUrl + "/hud");
          console.log(ok ? green("QR regenerated!") : red("QR generation failed"));
        } else {
          console.log(red("No tunnel URL — start tunnel first"));
        }
        break;
      case "p":
        if (githubPagesEnabled()) {
          msg = publishUrl();
          console.log(msg === "published" ? green("Published to GitHub!") : red(msg));
        } else {
          console.log(yellow("GitHub Pages not set up. Run: git init && git remote add origin ..."));
        }
        break;
      case "0":
      case "exit":
      case "quit":
        console.log(dim("Stopping tunnel..."));
        stopTunnel();
        console.log(dim("Goodbye."));
        rl.close();
        process.exit(0);
      default:
        if (cmd !== "r" && cmd !== "") console.log(dim("Unknown: " + cmd));
    }

    drawStatus();
    if (tunnelUrl) drawQR(tunnelUrl);
    drawMenu();
  });

  rl.on("close", () => process.exit(0));
}

main().catch(e => { console.error(red(e.message)); process.exit(1); });
