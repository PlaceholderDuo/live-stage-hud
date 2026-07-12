const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const PORT = 5800;
const PUBLIC_DIR = path.join(__dirname, 'public');
const BUMPER_DIR = path.join(os.homedir(), 'bumper-music');
const HOSTNAME = 'rig.local';

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function resolvePath(urlPath) {
  if (urlPath === '/hud') return path.join(PUBLIC_DIR, 'hud.html');
  if (urlPath === '/qr') return path.join(PUBLIC_DIR, 'qr.html');
  if (urlPath === '/display') return path.join(PUBLIC_DIR, 'display.html');
  if (urlPath === '/request') return path.join(PUBLIC_DIR, 'request.html');
  if (urlPath === '/') return path.join(PUBLIC_DIR, 'index.html');
  return path.join(PUBLIC_DIR, urlPath);
}

// ─── Bumper Music Engine ─────────────────────────────────────────

let bumperProcess = null;
let bumperPlaying = false;
let bumperPlaylist = [];
let bumperIndex = 0;

function scanBumperMusic() {
  try {
    const files = fs.readdirSync(BUMPER_DIR)
      .filter(f => /\.(m4a|mp3|wav)$/i.test(f))
      .sort(() => Math.random() - 0.5);
    bumperPlaylist = files.map(f => path.join(BUMPER_DIR, f));
    if (bumperPlaylist.length === 0) {
      console.warn('No bumper music files found in', BUMPER_DIR);
    }
  } catch (e) {
    console.warn('Cannot read bumper music dir:', e.message);
    bumperPlaylist = [];
  }
}

function bumperPlay(trackPath) {
  bumperStop();
  if (!trackPath || !fs.existsSync(trackPath)) {
    if (bumperPlaylist.length === 0) scanBumperMusic();
    if (bumperPlaylist.length === 0) return;
    bumperIndex = bumperIndex % bumperPlaylist.length;
    trackPath = bumperPlaylist[bumperIndex];
  }
  console.log('Bumper: play', path.basename(trackPath));
  bumperProcess = spawn('afplay', [trackPath], { stdio: 'ignore' });
  bumperPlaying = true;
  bumperProcess.on('exit', () => {
    bumperPlaying = false;
    bumperProcess = null;
    // Auto-advance to next track
    bumperIndex = (bumperIndex + 1) % bumperPlaylist.length;
    broadcastBumperStatus();
  });
  broadcastBumperStatus();
}

function bumperStop() {
  if (bumperProcess) {
    console.log('Bumper: stop');
    bumperProcess.kill();
    bumperProcess = null;
  }
  bumperPlaying = false;
  broadcastBumperStatus();
}

function bumperToggle() {
  if (bumperPlaying) {
    bumperStop();
  } else {
    bumperPlay(null);
  }
}

function bumperSkip() {
  if (bumperPlaylist.length === 0) scanBumperMusic();
  bumperIndex = (bumperIndex + 1) % bumperPlaylist.length;
  if (bumperPlaying) {
    bumperPlay(bumperPlaylist[bumperIndex]);
  }
}

function getBumperStatus() {
  return {
    type: 'bumper_status',
    playing: bumperPlaying,
    currentTrack: bumperPlaying && bumperPlaylist[bumperIndex]
      ? path.basename(bumperPlaylist[bumperIndex]).replace(/\.[^.]+$/, '')
      : null,
    queueSize: bumperPlaylist.length,
  };
}

function broadcastBumperStatus() {
  broadcast(getBumperStatus());
}

// Initial scan
scanBumperMusic();

// ─── HTTP Server ─────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Bumper web player page
  if (pathname === '/bumper') {
    const bumperHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>♪ Bumper Music</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#111; color:#eee; font-family:system-ui,sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; gap:2rem; }
  h1 { font-size:2rem; color:#ff8800; }
  #status { text-align:center; }
  #track-name { font-size:1.4rem; margin:0.5rem 0; }
  #state { font-size:1rem; color:#888; }
  .btn-group { display:flex; gap:1rem; flex-wrap:wrap; justify-content:center; }
  button { padding:1rem 2rem; font-size:1.2rem; border:2px solid #ff8800; background:#222; color:#ff8800; border-radius:8px; cursor:pointer; min-width:120px; }
  button:hover { background:#ff8800; color:#111; }
  button:active { transform:scale(0.95); }
  #playlist { width:100%; max-width:600px; margin-top:1rem; }
  #playlist h2 { color:#888; font-size:1rem; margin-bottom:0.5rem; }
  #playlist ol { list-style:decimal; padding-left:1.5rem; }
  #playlist li { padding:0.2rem 0; color:#666; font-size:0.85rem; }
  #playlist li.active { color:#ff8800; font-weight:bold; }
  .note { color:#555; font-size:0.85rem; text-align:center; max-width:500px; margin-top:2rem; }
</style>
</head><body>
  <h1>♪ Bumper Music</h1>
  <div id="status">
    <div id="track-name">—</div>
    <div id="state">Stopped</div>
  </div>
  <div class="btn-group">
    <button id="btn-toggle">▶ Play</button>
    <button id="btn-skip">⏭ Skip</button>
  </div>
  <div id="playlist">
    <h2>Queue</h2>
    <ol id="queue-list"></ol>
  </div>
  <div class="note">Also controllable from the iPhone Controller (double-tap ♪ Bumper button)</div>
  <script>
    const ws = new WebSocket('ws://' + location.host);
    const trackName = document.getElementById('track-name');
    const state = document.getElementById('state');
    const btnToggle = document.getElementById('btn-toggle');
    const btnSkip = document.getElementById('btn-skip');
    const queueList = document.getElementById('queue-list');

    let currentTrack = null;

    ws.onmessage = function(e) {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'bumper_status') {
        currentTrack = msg.currentTrack;
        trackName.textContent = msg.currentTrack || '—';
        state.textContent = msg.playing ? '▶ Playing' : '⏹ Stopped';
        btnToggle.textContent = msg.playing ? '⏹ Stop' : '▶ Play';
      }
    };

    btnToggle.onclick = function() {
      fetch('/bumper/api/toggle', { method:'POST' });
    };
    btnSkip.onclick = function() {
      fetch('/bumper/api/skip', { method:'POST' });
    };
  </script>
</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(bumperHtml);
    return;
  }

  // Bumper API
  if (pathname.startsWith('/bumper/api/')) {
    const action = pathname.split('/').pop();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (action === 'play') {
      bumperPlay(null);
      res.end(JSON.stringify(getBumperStatus()));
    } else if (action === 'stop') {
      bumperStop();
      res.end(JSON.stringify(getBumperStatus()));
    } else if (action === 'toggle') {
      bumperToggle();
      res.end(JSON.stringify(getBumperStatus()));
    } else if (action === 'skip') {
      bumperSkip();
      res.end(JSON.stringify(getBumperStatus()));
    } else if (action === 'status') {
      res.end(JSON.stringify(getBumperStatus()));
    } else {
      res.end(JSON.stringify({ error: 'unknown action' }));
    }
    return;
  }

  // Serve bumper-music files
  if (pathname.startsWith('/bumper-music/')) {
    const relPath = pathname.slice('/bumper-music/'.length);
    const filePath = path.join(BUMPER_DIR, relPath);
    // Prevent directory traversal
    if (!filePath.startsWith(BUMPER_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    sendFile(res, filePath);
    return;
  }

  if (pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'API not yet wired' }));
    return;
  }

  const filePath = resolvePath(pathname);
  sendFile(res, filePath);
});

// WebSocket
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected (' + clients.size + ' total)');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'command') {
      if (msg.action === 'bumper_toggle') {
        bumperToggle(); // broadcasts status internally
        return;
      }
      // TODO: relay to REAPER via OSC/MIDI
      broadcast({ type: 'command_ack', action: msg.action, status: 'received' });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected (' + clients.size + ' total)');
  });
});

function broadcast(data) {
  const str = JSON.stringify(data);
  clients.forEach((c) => {
    if (c.readyState === 1) c.send(str);
  });
}

// Mock state loop (simulates REAPER position data for development)
let simTime = 0;
setInterval(() => {
  if (clients.size === 0) return;
  simTime += 0.5;
  const bpm = 128;
  broadcast({
    type: 'state',
    bpm: bpm,
    position: simTime,
    duration: 240,
    currentSong: 'Test Song',
    currentArtist: 'Dev Mode',
    activeScene: 1,
    keysOn: true,
    activeAmpPreset: 'OSD',
  });
}, 500);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Live Show Manager running at http://${HOSTNAME}:${PORT}`);
  console.log(`  iPhone Controller: http://${HOSTNAME}:${PORT}/`);
  console.log(`  Request Page:      http://${HOSTNAME}:${PORT}/request`);
  console.log(`  Stage HUD:         http://${HOSTNAME}:${PORT}/hud`);
  console.log(`  WebSocket:         ws://${HOSTNAME}:${PORT}/`);
  console.log(`  Bumper Music:      http://${HOSTNAME}:${PORT}/bumper`);
  if (bumperPlaylist.length > 0) {
    console.log(`  Bumper tracks:     ${bumperPlaylist.length} (${BUMPER_DIR})`);
  }
});
