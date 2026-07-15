const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Server } = require('socket.io');

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

// ─── Bumper Music Engine (zero resources when idle) ─────────────

let bumperProcess = null;
let bumperPlaying = false;
let bumperPlaylist = [];
let bumperIndex = 0;
let bumperScanned = false;

function scanBumperMusic() {
  try {
    const files = fs.readdirSync(BUMPER_DIR)
      .filter(f => /\.(m4a|mp3|wav)$/i.test(f))
      .sort(() => Math.random() - 0.5);
    bumperPlaylist = files.map(f => path.join(BUMPER_DIR, f));
    bumperScanned = true;
    if (bumperPlaylist.length === 0) {
      console.warn('No bumper music files found in', BUMPER_DIR);
    }
  } catch (e) {
    console.warn('Cannot read bumper music dir:', e.message);
    bumperPlaylist = [];
    bumperScanned = true;
  }
}

function bumperPlay(trackPath) {
  bumperStop();
  if (!bumperScanned) scanBumperMusic();
  if (!trackPath || !fs.existsSync(trackPath)) {
    if (bumperPlaylist.length === 0) { if (!bumperScanned) scanBumperMusic(); if (bumperPlaylist.length === 0) return; }
    bumperIndex = bumperIndex % bumperPlaylist.length;
    trackPath = bumperPlaylist[bumperIndex];
  }
  console.log('Bumper: play', path.basename(trackPath));
  bumperProcess = spawn('afplay', [trackPath], { stdio: 'ignore' });
  bumperPlaying = true;
  bumperProcess.on('exit', () => {
    bumperPlaying = false;
    bumperProcess = null;
    bumperIndex = (bumperIndex + 1) % bumperPlaylist.length;
    broadcastBumperStatus();
  });
  broadcastBumperStatus();
}

function bumperStop() {
  if (bumperProcess) {
    console.log('Bumper: stop (fade out)');
    bumperFadeOut();
  }
}

function bumperStopImmediate() {
  if (bumperProcess) {
    console.log('Bumper: stop (immediate)');
    bumperProcess.kill();
    bumperProcess = null;
  }
  bumperPlaying = false;
  broadcastBumperStatus();
}

function bumperFadeOut() {
  if (!bumperProcess) return;
  const currentTrack = bumperPlaylist[bumperIndex];
  if (currentTrack && fs.existsSync(currentTrack)) {
    bumperProcess.kill();
    bumperProcess = null;
    const fadeFile = `/tmp/bumper-fade-${Date.now()}.wav`;
    const ffmpeg = spawn('ffmpeg', [
      '-sseof', '-4',
      '-i', currentTrack,
      '-af', 'afade=t=out:st=0:d=4',
      '-y', fadeFile
    ], { stdio: 'ignore' });
    ffmpeg.on('exit', () => {
      if (fs.existsSync(fadeFile)) {
        bumperProcess = spawn('afplay', [fadeFile], { stdio: 'ignore' });
        bumperProcess.on('exit', () => {
          try { fs.unlinkSync(fadeFile); } catch(e) {}
          bumperPlaying = false;
          bumperProcess = null;
          broadcastBumperStatus();
        });
      } else {
        bumperPlaying = false;
        broadcastBumperStatus();
      }
    });
    bumperPlaying = true; // still "playing" during fade out
  } else {
    bumperProcess.kill();
    bumperProcess = null;
    bumperPlaying = false;
    broadcastBumperStatus();
  }
}

function bumperToggle() {
  if (bumperPlaying) {
    bumperStop();
  } else {
    bumperPlay(null);
  }
}

function bumperSkip() {
  if (!bumperScanned) scanBumperMusic();
  if (bumperPlaylist.length === 0) return;
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
    queueSize: bumperScanned ? bumperPlaylist.length : 0,
  };
}

function broadcastBumperStatus() {
  broadcast(getBumperStatus());
}

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
    } else if (action === 'stop' || action === 'stop-graceful') {
      bumperStop();
      res.end(JSON.stringify(getBumperStatus()));
    } else if (action === 'stop-immediate') {
      bumperStopImmediate();
      res.end(JSON.stringify(getBumperStatus()));
    } else if (action === 'toggle') {
      bumperToggle();
      res.end(JSON.stringify(getBumperStatus()));
    } else if (action === 'skip') {
      bumperSkip();
      res.end(JSON.stringify(getBumperStatus()));
    } else if (action === 'status') {
      if (!bumperScanned) scanBumperMusic();
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
    // Proxy chordpro requests to main server (:3300)
    if (pathname.startsWith('/api/chordpro/')) {
      const songId = decodeURIComponent(pathname.slice('/api/chordpro/'.length));
      http.get(`http://localhost:3300/api/songs/${encodeURIComponent(songId)}`, (apiRes) => {
        let d = '';
        apiRes.on('data', c => d += c);
        apiRes.on('end', () => {
          try {
            const song = JSON.parse(d);
            const meta = song.meta || {};
            // Convert song data to ChordPro format
            let chordpro = `{title: ${meta.title || songId}}\n`;
            chordpro += `{artist: ${meta.artist || ''}}\n`;
            chordpro += `{key: ${meta.key || ''}}\n`;
            chordpro += `{bpm: ${meta.bpm || 120}}\n\n`;
            const lyrics = meta.lyrics || [];
            for (const l of lyrics) {
              if (l.text) chordpro += l.text + '\n';
            }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(chordpro);
          } catch (e) {
            res.writeHead(500);
            res.end('Error');
          }
        });
      }).on('error', () => {
        res.writeHead(502);
        res.end('Main server unreachable');
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'API not yet wired' }));
    return;
  }

  const filePath = resolvePath(pathname);
  sendFile(res, filePath);
});

// Socket.IO
const io = new Server(server);

io.on('connection', (socket) => {
  console.log('Client connected (' + io.engine.clientsCount + ' total)');

  socket.on('action', (data) => {
    // Forward action events to REAPER bridge (port 3000) via HTTP
    try {
      const body = JSON.stringify(data);
      const req = http.request({
        hostname: 'localhost', port: 3000, path: '/api/action',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, () => {});
      req.on('error', () => {});
      req.write(body);
      req.end();
    } catch(e) {}
    io.emit('command_ack', { type: 'command_ack', action: data.type, status: 'relayed' });
  });

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'command') {
      if (msg.action === 'bumper_toggle') {
        bumperToggle();
        return;
      }
      io.emit('command_ack', { type: 'command_ack', action: msg.action, status: 'received' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected (' + io.engine.clientsCount + ' total)');
  });
});

// Live state loop — fetches real song data from main server (:3300)
function fetchCurrentSong() {
  return new Promise((resolve) => {
    http.get('http://localhost:3300/api/queue/current', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          resolve(d.current_song || null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function emitState() {
  if (io.engine.clientsCount === 0) return;
  
  const song = await fetchCurrentSong();
  
  if (song && song.slug) {
    // Fetch song metadata for key/bpm/lyrics
    const meta = await new Promise((resolve) => {
      http.get(`http://localhost:3300/api/songs/${encodeURIComponent(song.slug)}`, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d).meta || {}); } catch { resolve({}); }
        });
      }).on('error', () => resolve({}));
    });

    io.emit('state', {
      currentSong: song.title || song.slug,
      currentArtist: song.artist || '',
      currentKey: song.key || meta.key || '',
      bpm: song.bpm || meta.bpm || 120,
      songId: song.slug,
      lyrics: meta.lyrics || [],
      position: 0,
      duration: meta.duration_bars ? meta.duration_bars * 2 : 240,
      activeScene: 1,
      keysOn: true,
    });
  } else {
    io.emit('state', {
      currentSong: '—',
      currentArtist: '',
      currentKey: '—',
      bpm: 120,
      songId: null,
      position: 0,
      duration: 0,
      activeScene: 0,
      keysOn: false,
    });
  }
}

setInterval(emitState, 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Live Show Manager running at http://${HOSTNAME}:${PORT}`);
  console.log(`  iPhone Controller: http://${HOSTNAME}:${PORT}/`);
  console.log(`  Request Page:      http://${HOSTNAME}:${PORT}/request`);
  console.log(`  Stage HUD:         http://${HOSTNAME}:${PORT}/hud`);
  console.log(`  WebSocket:         ws://${HOSTNAME}:${PORT}/`);
  console.log(`  Bumper Music:      http://${HOSTNAME}:${PORT}/bumper  (on-demand, 0 CPU idle)`);
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  bumperStop();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
