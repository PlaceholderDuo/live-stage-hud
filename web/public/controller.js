  /* === iPhone 7 Controller — Main Application === */
/* Modular page architecture — each page is a self-contained module */

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────
  const state = {
    currentPage: 'home',
    connected: false,
    tempo: 120,
    position: 0,
    muteState: 'live', // 'live' | 'vocal' | 'all'
    keysOn: true,
    activeScene: null,
    activeSong: null,
    activeAmpPreset: 'BE',
    lyricLines: [],
    settings: loadSettings(),
    lastStateTime: 0,
    lastPosition: 0,
    beatFlashAnim: null,
    // OSC feedback from REAPER
    trackVolumes: {},
    trackMutes: {},
    trackNames: {},
    trackLevels: [],
    fxParams: {},
    mixerValues: {},
    tuner: null,
    knobLabels: {
      1: { name: 'VOX', value: '--', color: '#1abc9c' },
      2: { name: 'GTR', value: '--', color: '#ff8800' },
      3: { name: 'BASS', value: '--', color: '#3399ff' },
      4: { name: 'REV MST', value: '--', color: '#9b59b6' },
    },
  };

  // ─── Settings Persistence ────────────────────────────
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem('liveControllerSettings')) || {};
    } catch {
      return {};
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem('liveControllerSettings', JSON.stringify(state.settings));
    } catch {
      // localStorage unavailable — silently ignore
    }
  }

  function getSetting(key, fallback) {
    return state.settings[key] !== undefined ? state.settings[key] : fallback;
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    saveSettings();
  }

  // ─── Page Registry ────────────────────────────────────
  const pages = {};
  let currentPageCleanup = null;

  function registerPage(name, module) {
    pages[name] = module;
  }

  function navigateTo(pageName, data) {
    if (currentPageCleanup && typeof currentPageCleanup === 'function') {
      try { currentPageCleanup(); } catch (e) { console.warn('Page cleanup error:', e); }
    }

    Object.values(pages).forEach(p => p.onDeactivate && p.onDeactivate());

    state.currentPage = pageName;
    const container = document.getElementById('page-container');
    container.innerHTML = '';

    const pageDiv = document.createElement('div');
    pageDiv.className = 'page active';
    pageDiv.dataset.controllerPage = pageName;
    pageDiv.id = 'page-' + pageName;
    container.appendChild(pageDiv);

    if (pages[pageName]) {
      pages[pageName].render(pageDiv, data);
      pages[pageName].onActivate && pages[pageName].onActivate(pageDiv, data);
    }

    updateKnobStrip(pageName);
  }

  // ─── Knob Strip ───────────────────────────────────────
  function updateKnobStrip(pageName) {
    const labels = document.querySelectorAll('.knob-label');
    labels.forEach(el => {
      const knob = parseInt(el.dataset.knob);
      const labelData = state.knobLabels[knob];
      if (labelData) {
        el.querySelector('.knob-label-name').textContent = labelData.name;
        el.querySelector('.knob-label-value').textContent = labelData.value;
        el.querySelector('.knob-label-name').style.color = labelData.color;
      }
    });
  }

  function setKnobLabels(knobs) {
    // knobs = { 1: { name, value, color }, 2: ..., 3: ..., 4: ... }
    Object.keys(knobs).forEach(k => {
      const idx = parseInt(k);
      if (idx >= 1 && idx <= 4) {
        state.knobLabels[idx] = { ...state.knobLabels[idx], ...knobs[k] };
      }
    });
    updateKnobStrip(state.currentPage);
  }

  // ─── Connection Status ────────────────────────────────
  function setConnectionStatus(status) {
    const dot = document.getElementById('connection-status');
    const text = document.getElementById('status-text');
    dot.className = 'status-dot ' + status;
    const texts = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting...' };
    text.textContent = texts[status] || status;
    state.connected = status === 'connected';
  }

  // ─── Beat Tracking ───────────────────────────────────
  var beatFlashEl = null;
  var lastBeatTrigger = -1;

  function createBeatFlash() {
    beatFlashEl = document.createElement('div');
    beatFlashEl.className = 'beat-flash';
    document.body.appendChild(beatFlashEl);
  }

  function predictedPosition() {
    if (state.lastStateTime > 0 && state.lastPosition > 0) {
      var dt = (performance.now() - state.lastStateTime) / 1000;
      return state.lastPosition + dt;
    }
    // No live position — run steady metronome at song BPM
    if (!state._metronomeRef) state._metronomeRef = performance.now();
    return (performance.now() - state._metronomeRef) / 1000;
  }

  function tickBeats() {
    if (!state.tempo || state.tempo < 20) return;
    var beatInterval = 60 / state.tempo;
    var pos = predictedPosition();
    var beatInSong = pos / beatInterval;
    var beatZero = Math.floor(beatInSong); // 0-indexed global beat
    var beatInMeasure = beatZero % 4; // 0=beat1, 1=beat2, 2=beat3, 3=beat4
    var timeSinceStart = (beatInSong - Math.floor(beatInSong)) * beatInterval;

    if (beatZero !== lastBeatTrigger && timeSinceStart < 0.04) {
      lastBeatTrigger = beatZero;
      var isDownbeat = beatInMeasure === 0;

      // Edge bar flash
      beatFlashEl.className = isDownbeat ? 'beat-flash beat-1' : 'beat-flash beat-234';
      clearTimeout(beatFlashEl._resetTimer);
      beatFlashEl._resetTimer = setTimeout(function () {
        if (beatFlashEl) beatFlashEl.className = 'beat-flash';
      }, 80);

      // Pulse dot — synced to same beat, no fade
      var pulseDot = document.getElementById('pulse-indicator');
      if (pulseDot) {
        pulseDot.style.opacity = '1';
        pulseDot.style.background = isDownbeat ? '#ffffff' : '#2ecc71';
        pulseDot.style.boxShadow = isDownbeat ? '0 0 6px rgba(255,255,255,0.5)' : 'none';
        clearTimeout(pulseDot._resetTimer);
        pulseDot._resetTimer = setTimeout(function () {
          pulseDot.style.opacity = '0.3';
          pulseDot.style.background = '#2ecc71';
          pulseDot.style.boxShadow = '';
        }, 80);
      }
    }
  }

  var beatLoopId = null;
  function startBeatLoop() {
    if (beatLoopId) return;
    function loop() {
      tickBeats();
      beatLoopId = requestAnimationFrame(loop);
    }
    beatLoopId = requestAnimationFrame(loop);
  }

  // ─── Socket.IO (existing Live Show Manager server) ───
  // The server uses Socket.IO with auto-reconnect built in.
  // Events: 'state' (merged bridge_state.json), 'fxData', 'trackLevels', etc.
  // Commands: socket.emit('action', { type, value })

  let socket = null;

  function connectSocketIO() {
    setConnectionStatus('connecting');

    socket = io({
      transports: ['polling', 'websocket'],
      timeout: 10000,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    socket.on('connect', function () {
      setConnectionStatus('connected');
    });

    socket.on('disconnect', function () {
      setConnectionStatus('disconnected');
    });

    socket.on('connect_error', function () {
      setConnectionStatus('disconnected');
    });

    socket.on('tuner', function (data) {
      state.tuner = data;
      if (state.currentPage === 'tuner') {
        updateTunerDisplay(data);
      }
    });

    socket.on('state', function (msg) {
      if (msg.bpm) state.tempo = msg.bpm;
      if (msg.position !== undefined && msg.position !== state.position) {
        state.lastPosition = msg.position;
        state.lastStateTime = performance.now();
        state.position = msg.position;
        state._metronomeRef = null; // reset metronome when live data arrives
      }
      if (msg.playing !== undefined) state.playing = msg.playing;
      if (msg.currentSong) state.activeSong = msg.currentSong;
      if (msg.activeScene !== undefined) state.activeScene = msg.activeScene;
      if (msg.keysOn !== undefined) {
        state.keysOn = msg.keysOn;
        var kb = document.getElementById('btn-keys');
        var kl = document.getElementById('keys-label');
        if (kb && kl) {
          kb.className = 'home-btn keys-btn ' + (state.keysOn ? 'on' : 'off');
          kl.textContent = state.keysOn ? 'KEYS ON' : 'KEYS OFF';
        }
      }
      if (msg.activeAmpPreset && msg.activeAmpPreset !== state._lastAmpFromServer) {
        state._lastAmpFromServer = msg.activeAmpPreset;
        state.activeAmpPreset = msg.activeAmpPreset;
        updateAmpHomeDisplay(msg.activeAmpPreset);
      }
      if (msg.lyricLines) {
        state.lyricLines = msg.lyricLines;
      }
      // New fields from OSC feedback
      if (msg.trackVolumes) state.trackVolumes = msg.trackVolumes;
      if (msg.trackMutes) state.trackMutes = msg.trackMutes;
      if (msg.trackNames) state.trackNames = msg.trackNames;
      if (msg.trackLevels) state.trackLevels = msg.trackLevels;
      if (msg.fxParams) state.fxParams = msg.fxParams;
      if (msg.mixerValues) state.mixerValues = msg.mixerValues;
      // Dispatch state to active page
      if (pages[state.currentPage] && pages[state.currentPage].onState) {
        pages[state.currentPage].onState(msg);
      }
    });
  }

  function sendCommand(action, value) {
    if (!socket || !socket.connected) return;
    socket.emit('action', { type: action, value: value || {} });
  }

  // ─── Double Tap Utility ──────────────────────────────
  function createDoubleTapHandler(element, onSingleTap, onDoubleTap, delay) {
    delay = delay || 300;
    let taps = 0;
    let timer = null;

    function handler() {
      taps++;
      if (taps === 1) {
        timer = setTimeout(function () {
          taps = 0;
          if (onSingleTap) onSingleTap();
        }, delay);
        element.classList.add('double-tap-first');
        setTimeout(function () {
          element.classList.remove('double-tap-first');
        }, delay);
      } else if (taps >= 2) {
        clearTimeout(timer);
        taps = 0;
        element.classList.remove('double-tap-first');
        if (onDoubleTap) onDoubleTap();
      }
    }

    element.addEventListener('click', handler);
    return function () {
      element.removeEventListener('click', handler);
    };
  }

  // ════════════════════════════════════════════════════════
  // ─── PAGE: HOME ──────────────────────────────────────
  // ════════════════════════════════════════════════════════

  registerPage('home', {
    render: function (container) {
      var ampColor = getAmpColor(state.activeAmpPreset);
      var ampBadge = getAmpBadge(state.activeAmpPreset);
      container.innerHTML = `
        <div class="transport-bar" id="transport-bar">
          <button class="trans-btn" id="btn-prev">⏮</button>
          <button class="trans-btn trans-play" id="btn-play">▶ PLAY</button>
          <button class="trans-btn" id="btn-next">⏭</button>
          <div class="trans-info">
            <div class="trans-song" id="trans-song">${state.activeSong || 'No song loaded'}</div>
            <div class="trans-pos" id="trans-pos">--</div>
          </div>
        </div>

        <div class="home-grid">
          <!-- Row 1: MUTE (safety) + START (primary action) — most prominent -->
          <div class="home-btn mute-btn live" id="btn-mute">
            <span class="home-btn-label" id="mute-label">LIVE</span>
            <span class="home-btn-sub" id="mute-sub">Tap to mute vocal</span>
          </div>

          <div class="home-btn start-btn" id="btn-start">
            <span class="home-btn-label">▶ START</span>
            <span class="home-btn-sub">Next song</span>
          </div>

          <!-- Row 2: Tap Tempo (full width) -->
          <div class="home-btn tap-tempo" id="tap-tempo-btn">
            <span class="bpm-label">BPM</span>
            <span class="bpm-display" id="bpm-display">${state.tempo}</span>
            <div class="pulse-indicator" id="pulse-indicator"></div>
          </div>

          <!-- Row 3: GTR AMP (current preset displayed) + TUNER -->
          <div class="home-btn gtr-amp-home" id="btn-gtr-amp" style="border-color: ${ampColor};">
            <span class="home-btn-label" style="color: ${ampColor};">GTR AMP</span>
            <span class="home-btn-sub" id="gtr-amp-sub">
              <span class="amp-dot" id="amp-dot" style="background: ${ampColor};"></span>
              ${state.activeAmpPreset}
              <span class="amp-badge" style="color: ${ampColor};">${ampBadge}</span>
            </span>
          </div>

          <div class="home-btn" id="btn-tuner" style="border-color: #ff8800;">
            <span class="home-btn-label" style="color: #ff8800;">Tuner</span>
            <span class="home-btn-sub">Guitar tune</span>
          </div>

          <!-- Row 4: EDM + GTR FX -->
          <div class="home-btn" id="btn-edm" style="border-color: #2ecc71;">
            <span class="home-btn-label" style="color: #2ecc71;">EDM</span>
            <span class="home-btn-sub">Scene control</span>
          </div>

          <div class="home-btn" id="btn-gtr-fx" style="border-color: #9b59b6;">
            <span class="home-btn-label" style="color: #9b59b6;">GTR FX</span>
            <span class="home-btn-sub">Delay & mod</span>
          </div>

          <!-- Row 5: KEYS + SETLIST -->
          <div class="home-btn keys-btn ${state.keysOn ? 'on' : 'off'}" id="btn-keys">
            <span class="home-btn-label" id="keys-label">${state.keysOn ? 'KEYS ON' : 'KEYS OFF'}</span>
            <span class="home-btn-sub">Hold for VST settings</span>
          </div>

          <div class="home-btn" id="btn-setlist" style="border-color: #3399ff;">
            <span class="home-btn-label" style="color: #3399ff;">Setlist</span>
            <span class="home-btn-sub">Songs & queue</span>
          </div>

          <!-- Row 6: MIXER + REQUESTS -->
          <div class="home-btn" id="btn-mixer" style="border-color: #7f8c8d;">
            <span class="home-btn-label" style="color: #95a5a6;">Mixer</span>
            <span class="home-btn-sub">Channel levels</span>
          </div>

          <div class="home-btn" id="btn-requests" style="border-color: #ff8800;">
            <span class="home-btn-label" style="color: #ff8800;">Requests <span class="req-badge" id="req-badge" style="display:none;">0</span></span>
            <span class="home-btn-sub" id="requests-sub">Guest songs</span>
          </div>

          <!-- Row 7: Battery -->
          <div class="home-btn" id="btn-battery" style="border-color: #f1c40f;">
            <span class="home-btn-label" style="color: #f1c40f;">Battery</span>
            <span class="home-btn-sub" id="battery-sub">No data</span>
          </div>
        </div>

        <!-- Small buttons row -->
        <div class="home-small-row">
          <div class="small-btn" id="btn-bumper">
            <span>♪ Bumper</span>
            <span class="double-tap-hint">⟐⟐ DOUBLE TAP</span>
          </div>
          <div class="small-btn" id="btn-settings">
            <span>⚙ Settings</span>
          </div>
        </div>
      `;
    },

    onActivate: function (container) {
      // Restore home knob labels
      setKnobLabels({
        1: { name: 'VOX', value: '--', color: '#1abc9c' },
        2: { name: 'GTR', value: '--', color: '#ff8800' },
        3: { name: 'BASS', value: '--', color: '#3399ff' },
        4: { name: 'REV MST', value: '--', color: '#9b59b6' },
      });

      // Transport: Play/Pause
      document.getElementById('btn-play').addEventListener('click', function () {
        sendCommand('play');
      });

      // Transport: Next song
      document.getElementById('btn-next').addEventListener('click', function () {
        sendCommand('next');
      });

      // Transport: Prev song
      document.getElementById('btn-prev').addEventListener('click', function () {
        sendCommand('prev');
      });

      updateTransportDisplay();

      // Tap Tempo
      document.getElementById('tap-tempo-btn').addEventListener('click', function () {
        sendCommand('tap_tempo');
      });

      // EDM
      document.getElementById('btn-edm').addEventListener('click', function () {
        navigateTo('edm');
      });

      // Setlist
      document.getElementById('btn-setlist').addEventListener('click', function () {
        navigateTo('setlist');
      });

      // MIXER
      document.getElementById('btn-mixer').addEventListener('click', function () {
        navigateTo('mixer');
      });

      // Battery
      document.getElementById('btn-battery').addEventListener('click', function () {
        navigateTo('battery');
      });

      // MUTE
      document.getElementById('btn-mute').addEventListener('click', function () {
        cycleMute();
      });

      // TUNER
      document.getElementById('btn-tuner').addEventListener('click', function () {
        navigateTo('tuner');
      });

      // GTR FX
      document.getElementById('btn-gtr-fx').addEventListener('click', function () {
        navigateTo('gtr-fx');
      });

      // GTR AMP
      document.getElementById('btn-gtr-amp').addEventListener('click', function () {
        navigateTo('gtr-amp');
      });

      // KEYS — short press toggle, long press -> VST settings (future)
      var keysBtn = document.getElementById('btn-keys');
      var keysTimer = null;
      keysBtn.addEventListener('pointerdown', function () {
        keysTimer = setTimeout(function () {
          keysTimer = null;
          navigateTo('vst-settings');
        }, 600);
      });
      keysBtn.addEventListener('pointerup', function () {
        if (keysTimer) {
          clearTimeout(keysTimer);
          keysTimer = null;
          toggleKeys();
        }
      });
      keysBtn.addEventListener('pointerleave', function () {
        if (keysTimer) {
          clearTimeout(keysTimer);
          keysTimer = null;
        }
      });

      // START
      document.getElementById('btn-start').addEventListener('click', function () {
        sendCommand('start_song');
        var btn = this;
        btn.style.background = '#0a2a0a';
        setTimeout(function () { btn.style.background = ''; }, 200);
      });

      // REQUESTS
      document.getElementById('btn-requests').addEventListener('click', function () {
        navigateTo('requests');
      });

      // Bumper Music (double tap)
      const bumperBtn = document.getElementById('btn-bumper');
      createDoubleTapHandler(bumperBtn,
        function () { /* first tap — do nothing, wait for second */ },
        function () {
          sendCommand('bumper_toggle');
          bumperBtn.style.borderColor = '#ff8800';
          bumperBtn.style.color = '#ff8800';
          setTimeout(function () {
            bumperBtn.style.borderColor = '';
            bumperBtn.style.color = '';
          }, 500);
        }
      );

      // Settings
      document.getElementById('btn-settings').addEventListener('click', function () {
        navigateTo('settings');
      });
    },

    onState: function (msg) {
      if (msg.bpm) {
        document.getElementById('bpm-display').textContent = Math.round(msg.bpm);
      }
      if (msg.activeAmpPreset && msg.activeAmpPreset !== state._lastAmpFromServer) {
        state._lastAmpFromServer = msg.activeAmpPreset;
        state.activeAmpPreset = msg.activeAmpPreset;
        updateAmpHomeDisplay(msg.activeAmpPreset);
      }
      updateTransportDisplay();
    },
  });

  function updateTransportDisplay() {
    var song = document.getElementById('trans-song');
    var pos = document.getElementById('trans-pos');
    var btn = document.getElementById('btn-play');
    if (song) song.textContent = state.activeSong || 'No song loaded';
    if (pos) {
      var bar = state.tempo > 0 ? Math.floor((state.position || 0) * state.tempo / 240) + 1 : 1;
      pos.textContent = 'Bar ' + bar + ' \u00B7 ' + formatTime(state.position) + ' / ' + formatTime(state.duration);
    }
    if (btn) {
      btn.textContent = state.playing ? '\u23F8 PAUSE' : '\u25B6 PLAY';
      btn.className = 'trans-btn trans-play' + (state.playing ? ' playing' : '');
    }
  }

  function formatTime(secs) {
    if (!secs || secs < 0) return '0:00';
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ─── KEYS Toggle ────────────────────────────────────
  function toggleKeys() {
    state.keysOn = !state.keysOn;
    var btn = document.getElementById('btn-keys');
    var label = document.getElementById('keys-label');
    if (state.keysOn) {
      btn.className = 'home-btn keys-btn on';
      label.textContent = 'KEYS ON';
      sendCommand('keys_toggle', { on: true });
    } else {
      btn.className = 'home-btn keys-btn off';
      label.textContent = 'KEYS OFF';
      sendCommand('keys_toggle', { on: false });
    }
  }

  // ─── Mute State Machine ──────────────────────────────
  function cycleMute() {
    const btn = document.getElementById('btn-mute');
    const label = document.getElementById('mute-label');
    const sub = document.getElementById('mute-sub');

    if (state.muteState === 'live') {
      state.muteState = 'vocal';
      btn.className = 'home-btn mute-btn mute-vocal';
      label.textContent = 'MUTED: VOCAL';
      sub.textContent = 'Tap to also mute PA';
      sendCommand('mute_with_level', { level: 'vocal' });
    } else if (state.muteState === 'vocal') {
      state.muteState = 'all';
      btn.className = 'home-btn mute-btn mute-all';
      label.textContent = 'MUTED: ALL';
      sub.textContent = 'Tap to restore';
      sendCommand('mute_with_level', { level: 'all' });
    } else {
      state.muteState = 'live';
      btn.className = 'home-btn mute-btn live';
      label.textContent = 'LIVE';
      sub.textContent = 'Tap to mute vocal';
      sendCommand('mute_with_level', { level: 'none' });
    }
  }

  // ════════════════════════════════════════════════════════
  // ─── PAGE: EDM ───────────────────────────────────────
  // ════════════════════════════════════════════════════════

  var edmScenes = [
    { name: 'Intro', energy: 'Low', color: '#9b59b6' },
    { name: 'Build', energy: 'Rising', color: '#3498db' },
    { name: 'Drop', energy: 'MAX', color: '#2ecc71' },
    { name: 'Breakdown', energy: 'Low', color: '#f1c40f' },
    { name: 'Guitar Jam', energy: 'High', color: '#e67e22' },
    { name: 'Transition', energy: 'Rising', color: '#1abc9c' },
    { name: 'Final Drop', energy: 'MAX', color: '#e74c3c' },
    { name: 'Outro', energy: 'Ending', color: '#7f8c8d' },
  ];

  registerPage('edm', {
    render: function (container) {
      var html = '<div class="edm-scene-grid">';
      edmScenes.forEach(function (s, i) {
        var active = (i + 1) === state.activeScene ? ' active' : '';
        html += '<div class="edm-scene-btn' + active + '" data-scene="' + (i + 1) + '" style="border-color: ' + s.color + ';">';
        html += '<div class="scene-name" style="color: ' + s.color + ';">' + s.name + '</div>';
        html += '<div class="scene-energy">' + s.energy + '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '<div class="edm-knob-values" style="display:flex;gap:8px;padding:12px 0;">';
      html += '  <div class="edm-knob-card" id="edm-kv-filter"><div class="kv-label">FILTER</div><div class="kv-value">--</div></div>';
      html += '  <div class="edm-knob-card" id="edm-kv-res"><div class="kv-label">RES</div><div class="kv-value">--</div></div>';
      html += '  <div class="edm-knob-card" id="edm-kv-rev"><div class="kv-label">REV</div><div class="kv-value">--</div></div>';
      html += '  <div class="edm-knob-card" id="edm-kv-delay"><div class="kv-label">DELAY</div><div class="kv-value">--</div></div>';
      html += '</div>';
      html += '<button class="edm-return" id="edm-return">← Back</button>';
      container.innerHTML = html;

      container.querySelectorAll('.edm-scene-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var scene = parseInt(this.dataset.scene);
          sendCommand('scene_select', { scene: scene });
          container.querySelectorAll('.edm-scene-btn').forEach(function (b) {
            b.classList.remove('active');
          });
          this.classList.add('active');
        });
      });

      container.querySelector('#edm-return').addEventListener('click', function () {
        navigateTo('home');
      });
    },

    onActivate: function () {
      setKnobLabels({
        1: { name: 'FILTER', value: '--', color: '#3498db' },
        2: { name: 'RES', value: '--', color: '#9b59b6' },
        3: { name: 'REV', value: '--', color: '#1abc9c' },
        4: { name: 'DELAY', value: '--', color: '#e67e22' },
      });
    },

    onState: function (msg) {
      if (msg.mixerValues) {
        updateEDMKnobValues(msg.mixerValues);
      }
    },
  });

  function updateEDMKnobValues(mv) {
    var map = { filter: 'edm-kv-filter', res: 'edm-kv-res', rev: 'edm-kv-rev', delay: 'edm-kv-delay' };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (el && mv[k] !== undefined) {
        el.querySelector('.kv-value').textContent = Math.round(mv[k] * 100) + '%';
      }
    });
  }

  // ════════════════════════════════════════════════════════
  // ─── PAGE: TUNER ─────────────────────────────────────
  // ════════════════════════════════════════════════════════

  registerPage('tuner', {
    render: function (container) {
      var teleprompterChecked = getSetting('tunerTeleprompter', false) ? 'checked' : '';
      container.innerHTML =
        '<div class="tuner-note" id="tuner-note">--</div>' +
        '<div class="tuner-strobe" id="tuner-strobe">' +
          '<div class="tuner-strobe-center"></div>' +
          '<div class="tuner-strobe-needle" id="tuner-needle" style="left:50%;"></div>' +
          '<div class="tuner-strobe-in-tune" id="tuner-strobe-green"></div>' +
        '</div>' +
        '<div class="tuner-cents" id="tuner-cents">--</div>' +
        '<div class="tuner-string" id="tuner-string"></div>' +
        '<div class="tuner-freq" id="tuner-freq"></div>' +
        '<label class="tuner-teleprompter-check">' +
          '<input type="checkbox" id="tuner-teleprompter" ' + teleprompterChecked + '>' +
          'Display on teleprompter' +
        '</label>' +
        '<button class="tuner-back" id="tuner-back">← Back</button>';

      document.getElementById('tuner-teleprompter').addEventListener('change', function () {
        setSetting('tunerTeleprompter', this.checked);
        sendCommand('tuner_teleprompter', { enabled: this.checked });
      });

      document.getElementById('tuner-back').addEventListener('click', function () {
        navigateTo('home');
      });
    },

    onActivate: function () {
      setKnobLabels({
        1: { name: '--', value: '', color: '#333' },
        2: { name: '--', value: '', color: '#333' },
        3: { name: '--', value: '', color: '#333' },
        4: { name: '--', value: '', color: '#333' },
      });
    },

    onState: function (msg) {
      if (msg.tuner) {
        state.tuner = msg.tuner;
        updateTunerDisplay(msg.tuner);
      }
    },
  });

  function updateTunerDisplay(data) {
    var note = document.getElementById('tuner-note');
    var needle = document.getElementById('tuner-needle');
    var strobeGreen = document.getElementById('tuner-strobe-green');
    var cents = document.getElementById('tuner-cents');
    var str = document.getElementById('tuner-string');
    var freq = document.getElementById('tuner-freq');

    if (!data) data = {};
    var c = data.cents || 0;
    var noteName = data.note || '--';
    var inTune = Math.abs(c) < 3;

    if (note) {
      note.textContent = noteName;
      note.className = 'tuner-note';
      if (!noteName || noteName === '--') note.classList.add('out');
      else if (inTune) note.classList.add('in-tune');
      else if (c > 0) note.classList.add('sharp');
      else note.classList.add('flat');
    }

    // Strobe needle position: cents -50 to +50 → 0% to 100% width
    if (needle) {
      var clamped = Math.max(-50, Math.min(50, c));
      var pos = ((clamped + 50) / 100) * 100;
      needle.style.left = pos + '%';
    }

    // Green fill when in tune
    if (strobeGreen) {
      if (inTune) {
        strobeGreen.classList.add('active');
        strobeGreen.classList.add('shimmer');
        // Width proportional to how in-tune: 3¢ = narrow, 0¢ = full width
        var greenWidth = Math.max(10, 100 - Math.abs(c) * 20);
        strobeGreen.style.left = (50 - greenWidth / 2) + '%';
        strobeGreen.style.width = greenWidth + '%';
      } else {
        strobeGreen.classList.remove('active');
        strobeGreen.classList.remove('shimmer');
      }
    }

    if (cents) {
      cents.textContent = (c > 0 ? '+' : '') + c.toFixed(1) + '\u00A2';
      cents.className = 'tuner-cents';
      if (inTune) cents.classList.add('in-tune');
      else if (c > 0) cents.classList.add('sharp');
      else cents.classList.add('flat');
    }

    if (str) str.textContent = data.string || '';
    if (freq) freq.textContent = data.frequency ? data.frequency.toFixed(1) + ' Hz' : '';
  }

  // ════════════════════════════════════════════════════════
  // ─── PAGE: GTR FX ────────────────────────────────────
  // ════════════════════════════════════════════════════════

  registerPage('gtr-fx', {
    render: function (container) {
      container.innerHTML =
        '<div class="fx-param-grid">' +
          '<div class="fx-param-card"><div class="fx-param-name">Delay Time</div><div class="fx-param-value" id="fx-delay-time">--</div></div>' +
          '<div class="fx-param-card"><div class="fx-param-name">Feedback</div><div class="fx-param-value" id="fx-feedback">--</div></div>' +
          '<div class="fx-param-card"><div class="fx-param-name">Mod Rate</div><div class="fx-param-value" id="fx-mod-rate">--</div></div>' +
          '<div class="fx-param-card"><div class="fx-param-name">Mod Depth</div><div class="fx-param-value" id="fx-mod-depth">--</div></div>' +
        '</div>' +
        '<button class="gtr-fx-return" id="gtr-fx-return">← Back</button>';

      document.getElementById('gtr-fx-return').addEventListener('click', function () {
        navigateTo('home');
      });
    },

    onActivate: function () {
      setKnobLabels({
        1: { name: 'DELAY', value: '--', color: '#1abc9c' },
        2: { name: 'FEEDBK', value: '--', color: '#e74c3c' },
        3: { name: 'MOD RT', value: '--', color: '#9b59b6' },
        4: { name: 'MOD DP', value: '--', color: '#f1c40f' },
      });
    },

    onState: function (msg) {
      if (msg.fx) {
        setKnobLabels(msg.fx.knobs || {});
        ['delay-time', 'feedback', 'mod-rate', 'mod-depth'].forEach(function (id) {
          var el = document.getElementById('fx-' + id);
          if (el && msg.fx[id]) el.textContent = msg.fx[id];
        });
      }
      // Live FX params from OSC feedback
      if (msg.fxParams) {
        var vals = { 'delay-time': '--', 'feedback': '--', 'mod-rate': '--', 'mod-depth': '--' };
        // GTR track = 6, FX = 1, params 1-4
        if (msg.fxParams['6-1-1'] !== undefined) vals['delay-time'] = Math.round(msg.fxParams['6-1-1'] * 100) + '%';
        if (msg.fxParams['6-1-2'] !== undefined) vals['feedback'] = Math.round(msg.fxParams['6-1-2'] * 100) + '%';
        if (msg.fxParams['6-1-3'] !== undefined) vals['mod-rate'] = (msg.fxParams['6-1-3'] * 20).toFixed(1) + ' Hz';
        if (msg.fxParams['6-1-4'] !== undefined) vals['mod-depth'] = Math.round(msg.fxParams['6-1-4'] * 100) + '%';
        Object.keys(vals).forEach(function (id) {
          var el = document.getElementById('fx-' + id);
          if (el) el.textContent = vals[id];
        });
      }
    },
  });

  // ════════════════════════════════════════════════════════
  // ─── PAGE: SETLIST ───────────────────────────────────
  // ════════════════════════════════════════════════════════

  registerPage('setlist', {
    render: function (container) {
      container.innerHTML =
        '<div class="setlist-header">' +
          '<h2>Setlist</h2>' +
          '<button class="setlist-return" id="setlist-return">← Back</button>' +
        '</div>' +
        '<div class="setlist-queue" id="setlist-queue">' +
          '<div style="text-align:center;color:#555;padding:40px;font-size:14px;">No setlist loaded. Start the show on TUI.</div>' +
        '</div>';
    },

    onActivate: function () {
      document.getElementById('setlist-return').addEventListener('click', function () {
        navigateTo('home');
      });
      setKnobLabels({
        1: { name: '--', value: '', color: '#333' },
        2: { name: '--', value: '', color: '#333' },
        3: { name: '--', value: '', color: '#333' },
        4: { name: '--', value: '', color: '#333' },
      });
    },

    onState: function (msg) {
      renderSetlistFromState(msg);
    },
  });

  function renderSetlistFromState(msg) {
    var el = document.getElementById('setlist-queue');
    if (!el) return;
    var songs = msg.setlist || [];
    var activeIdx = msg.songIndex ? msg.songIndex - 1 : -1;
    if (songs.length === 0) {
      el.innerHTML = '<div style="text-align:center;color:#555;padding:40px;font-size:14px;">No setlist loaded. Start the show on TUI.</div>';
      return;
    }
    var html = '';
    songs.forEach(function (song, i) {
      var isActive = i === activeIdx;
      var isPast = i < activeIdx;
      html += '<div class="queue-item' + (isActive ? ' active' : '') + (isPast ? ' past' : '') + '">';
      html += '  <span class="queue-num">' + (i + 1) + '</span>';
      html += '  <div class="queue-info">';
      html += '    <span class="song-title">' + (song.title || 'Unknown') + '</span>';
      html += '    <span class="song-artist">' + (song.artist || '') + '</span>';
      html += '  </div>';
      html += '  <span class="queue-status">' + (isActive ? '▶ NOW' : isPast ? '✓' : '') + '</span>';
      html += '</div>';
    });
    el.innerHTML = html;
  }

  function renderQueue(queue, activeIndex) {
    var el = document.getElementById('setlist-queue');
    if (!el || !queue || !queue.length) {
      el.innerHTML = '<div style="text-align:center;color:#666;padding:40px;font-size:14px;">Empty queue</div>';
      return;
    }
    var html = '';
    queue.forEach(function (song, i) {
      var active = i === activeIndex ? ' active' : '';
      html += '<div class="queue-item' + active + '" data-queue-index="' + i + '" draggable="true">';
      html += '  <span class="queue-drag-handle">⋮⋮</span>';
      html += '  <span class="song-title">' + (song.title || 'Unknown') + '</span>';
      html += '  <span class="song-artist">' + (song.artist || '') + '</span>';
      html += '  <div class="queue-controls">';
      html += '    <button data-action="skip" data-index="' + i + '">Skip</button>';
      html += '    <button data-action="remove" data-index="' + i + '">✕</button>';
      html += '  </div>';
      html += '</div>';
    });
    el.innerHTML = html;

    el.querySelectorAll('[data-action="skip"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendCommand('queue_skip', { index: parseInt(this.dataset.index) });
      });
    });

    el.querySelectorAll('[data-action="remove"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendCommand('queue_remove', { index: parseInt(this.dataset.index) });
      });
    });

    // Drag reorder support
    var dragSrc = null;
    el.querySelectorAll('.queue-item').forEach(function (item) {
      item.addEventListener('touchstart', function (e) {
        dragSrc = this;
        this.classList.add('queue-dragging');
      }, { passive: true });

      item.addEventListener('touchmove', function (e) {
        if (!dragSrc) return;
        e.preventDefault();
        var touch = e.touches[0];
        var target = document.elementFromPoint(touch.clientX, touch.clientY);
        var targetItem = target ? target.closest('.queue-item') : null;
        if (targetItem && targetItem !== dragSrc) {
          var items = Array.from(el.querySelectorAll('.queue-item'));
          var srcIdx = items.indexOf(dragSrc);
          var tgtIdx = items.indexOf(targetItem);
          if (srcIdx >= 0 && tgtIdx >= 0 && srcIdx !== tgtIdx) {
            if (srcIdx < tgtIdx) {
              el.insertBefore(dragSrc, targetItem.nextSibling);
            } else {
              el.insertBefore(dragSrc, targetItem);
            }
          }
        }
      });

      item.addEventListener('touchend', function () {
        if (dragSrc) {
          dragSrc.classList.remove('queue-dragging');
          dragSrc = null;
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════
  // ─── PAGE: SETTINGS ──────────────────────────────────
  // ════════════════════════════════════════════════════════

  registerPage('settings', {
    render: function (container) {
      container.innerHTML =
        '<div class="settings-header">' +
          '<h2>Settings</h2>' +
          '<button class="settings-return" id="settings-return">← Back</button>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h3>General</h3>' +
          '<div class="settings-item">' +
            '<span class="label">Tuner on teleprompter</span>' +
            '<span class="value">' + (getSetting('tunerTeleprompter', false) ? 'ON' : 'OFF') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<h3>Troubleshooting</h3>' +
          '<div id="troubleshoot-area">' +
            '<div class="troubleshoot-entry">' +
              '<div class="entry-label">Connection</div>' +
              '<div class="entry-value ' + (state.connected ? 'ok' : 'fail') + '" id="ts-connection">' +
                (state.connected ? 'Connected' : 'Disconnected') +
              '</div>' +
            '</div>' +
            '<div class="troubleshoot-entry">' +
              '<div class="entry-label">Tempo</div>' +
              '<div class="entry-value" id="ts-tempo">' + state.tempo + ' BPM</div>' +
            '</div>' +
            '<div class="troubleshoot-entry">' +
              '<div class="entry-label">Active Song</div>' +
              '<div class="entry-value" id="ts-song">' + (state.activeSong || '--') + '</div>' +
            '</div>' +
            '<div class="troubleshoot-entry">' +
              '<div class="entry-label">Mute State</div>' +
              '<div class="entry-value" id="ts-mute">' + state.muteState + '</div>' +
            '</div>' +
            '<div class="troubleshoot-entry">' +
              '<div class="entry-label">Keys (VST)</div>' +
              '<div class="entry-value ' + (state.keysOn ? 'ok' : 'warn') + '" id="ts-keys">' + (state.keysOn ? 'ON' : 'OFF') + '</div>' +
            '</div>' +
            '<div class="troubleshoot-entry">' +
              '<div class="entry-label">GTR Amp Preset</div>' +
              '<div class="entry-value" id="ts-amp">' + state.activeAmpPreset + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.getElementById('settings-return').addEventListener('click', function () {
        navigateTo('home');
      });
    },

    onState: function (msg) {
      var el;
      if (msg.bpm) {
        el = document.getElementById('ts-tempo');
        if (el) el.textContent = Math.round(msg.bpm) + ' BPM';
      }
      if (msg.currentSong) {
        el = document.getElementById('ts-song');
        if (el) el.textContent = msg.currentSong;
      }
    },
  });

  // ════════════════════════════════════════════════════════
  // ─── GTR AMP PRESETS ─────────────────────────────────
  // ════════════════════════════════════════════════════════

  var gtrAmpPresets = [
    { name: 'BE',       type: 'drive', label: 'DRIVE', color: '#e74c3c' },
    { name: 'SSS',      type: 'clean', label: 'CLEAN', color: '#3399ff' },
    { name: 'Acoustic', type: 'acoustic', label: 'ACOUSTIC', color: '#2ecc71' },
  ];

  function getAmpColor(presetName) {
    for (var i = 0; i < gtrAmpPresets.length; i++) {
      if (gtrAmpPresets[i].name === presetName) return gtrAmpPresets[i].color;
    }
    return '#e74c3c';
  }

  function getAmpBadge(presetName) {
    for (var i = 0; i < gtrAmpPresets.length; i++) {
      if (gtrAmpPresets[i].name === presetName) return gtrAmpPresets[i].label || '--';
    }
    return '--';
  }

  function updateAmpHomeDisplay(preset) {
    var sub = document.getElementById('gtr-amp-sub');
    var btn = document.getElementById('btn-gtr-amp');
    var dot = document.getElementById('amp-dot');
    var color = getAmpColor(preset);
    if (btn) btn.style.borderColor = color;
    if (dot) dot.style.background = color;
    if (sub) {
      sub.innerHTML = '<span class="amp-dot" id="amp-dot" style="background:' + color + ';"></span> ' + preset + ' <span class="amp-badge" style="color:' + color + ';">' + getAmpBadge(preset) + '</span>';
      sub.id = 'gtr-amp-sub';
    }
    // Confirmation flash on home button
    if (btn) {
      btn.style.boxShadow = '0 0 18px ' + color;
      btn.style.transform = 'scale(1.03)';
      setTimeout(function () {
        btn.style.boxShadow = '';
        btn.style.transform = '';
      }, 400);
    }
  }

  registerPage('gtr-amp', {
    render: function (container) {
      var html =
        '<div class="gtr-amp-header">' +
          '<h2>GTR AMP</h2>' +
          '<button class="gtr-amp-return" id="gtr-amp-return">← Back</button>' +
        '</div>' +
        '<div class="gtr-amp-grid">';

      gtrAmpPresets.forEach(function (p) {
        var active = p.name === state.activeAmpPreset ? ' active' : '';
        html +=
          '<div class="gtr-amp-preset' + active + '" data-preset="' + p.name + '" style="border-color: ' + p.color + ';">' +
            '<div class="preset-name" style="color: ' + p.color + ';">' + p.name + '</div>' +
            '<div class="preset-badge" style="color: ' + p.color + ';">' + (p.label || '--') + '</div>' +
            '<div class="preset-confirm" style="background:' + p.color + ';">\u2713</div>' +
          '</div>';
      });

      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.gtr-amp-preset').forEach(function (el) {
        el.addEventListener('click', function () {
          var preset = this.dataset.preset;
          if (state.activeAmpPreset === preset) return;

          state.activeAmpPreset = preset;
          sendCommand('gtr_amp_preset', { preset: preset });

          // Confirmation animation on the tapped preset
          var confirm = this.querySelector('.preset-confirm');
          this.classList.add('applied');
          if (confirm) confirm.classList.add('show');

          // Deactivate others
          container.querySelectorAll('.gtr-amp-preset').forEach(function (b) {
            b.classList.remove('active');
            var c = b.querySelector('.preset-confirm');
            if (c) c.classList.remove('show');
          });

          this.classList.add('active');

          // Clear confirmation after animation
          var self = this;
          setTimeout(function () {
            self.classList.remove('applied');
            if (confirm) confirm.classList.remove('show');
          }, 600);

          updateAmpHomeDisplay(preset);
        });
      });

      document.getElementById('gtr-amp-return').addEventListener('click', function () {
        navigateTo('home');
      });
    },

    onActivate: function () {
      setKnobLabels({
        1: { name: '--', value: '', color: '#333' },
        2: { name: '--', value: '', color: '#333' },
        3: { name: '--', value: '', color: '#333' },
        4: { name: '--', value: '', color: '#333' },
      });
    },
  });

  // ════════════════════════════════════════════════════════
  // ─── PAGE: MIXER ──────────────────────────────────────
  // ════════════════════════════════════════════════════════

  var DEFAULT_TRACK_NAMES = ['DRUMS','BASS','PADS','LEADS','PLUCKS','GTR','VOX','MASTER'];

  registerPage('mixer', {
    render: function (container) {
      container.innerHTML =
        '<div class="mixer-header">' +
          '<h2>Mixer</h2>' +
          '<button class="mixer-return" id="mixer-return">← Back</button>' +
        '</div>' +
        '<div class="mixer-channels" id="mixer-channels">' +
          '<div style="text-align:center;color:#666;padding:40px;font-size:14px;">No track data</div>' +
        '</div>';
    },

    onActivate: function () {
      document.getElementById('mixer-return').addEventListener('click', function () {
        navigateTo('home');
      });
      setKnobLabels({
        1: { name: 'VOX', value: formatDB(state.trackVolumes[6] || state.trackVolumes['6']), color: '#1abc9c' },
        2: { name: 'GTR', value: formatDB(state.trackVolumes[5] || state.trackVolumes['5']), color: '#ff8800' },
        3: { name: 'BASS', value: formatDB(state.trackVolumes[1] || state.trackVolumes['1']), color: '#3399ff' },
        4: { name: 'REV MST', value: '--', color: '#9b59b6' },
      });
      renderMixer();
    },

    onState: function (msg) {
      renderMixer();
    },
  });

  function renderMixer() {
    var el = document.getElementById('mixer-channels');
    if (!el) return;

    var levels = state.trackLevels || [];
    var volumes = state.trackVolumes || {};
    var mutes = state.trackMutes || {};
    var names = state.trackNames || {};
    if (Object.keys(names).length === 0) names = {};

    // Use trackLevels from bridge_state.json if available
    var maxChannels = Math.max(8, levels.length || 0);
    if (maxChannels === 0) {
      el.innerHTML = '<div style="text-align:center;color:#555;padding:40px;font-size:14px;">Waiting for REAPER data...</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < maxChannels; i++) {
      var idx = i + 1;
      var name = names[idx] || names[String(idx)] || (DEFAULT_TRACK_NAMES[i] || ('Track ' + idx));
      var level = levels[i] !== undefined ? levels[i] : 0;
      var vol = volumes[idx] || volumes[String(idx)];
      var muted = mutes[idx] || mutes[String(idx)] || false;
      var dbStr = formatDB(vol);
      var pct = Math.min(100, Math.max(0, level * 100));
      var barColor = pct > 85 ? '#e74c3c' : pct > 60 ? '#f1c40f' : '#2ecc71';
      var muteClass = muted ? ' muted' : '';

      html += '<div class="mixer-channel' + muteClass + '">';
      html += '  <div class="mc-label">' + escapeHtml(name) + '</div>';
      html += '  <div class="mc-meter">';
      html += '    <div class="mc-meter-fill" style="width:' + pct + '%;background:' + barColor + ';"></div>';
      html += '  </div>';
      html += '  <div class="mc-values">';
      html += '    <span class="mc-level">' + pct.toFixed(0) + '%</span>';
      html += '    <span class="mc-db">' + dbStr + '</span>';
      html += '  </div>';
      html += '  <button class="mc-mute-btn" data-track="' + idx + '">' + (muted ? 'UNMUTE' : 'MUTE') + '</button>';
      html += '</div>';
    }
    el.innerHTML = html;

    el.querySelectorAll('.mc-mute-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var track = parseInt(this.dataset.track);
        var currentlyMuted = state.trackMutes[track] || state.trackMutes[String(track)];
        sendCommand('mute', { track: track, state: !currentlyMuted });
      });
    });
  }

  function formatDB(vol) {
    if (vol === undefined || vol === null) return '-- dB';
    if (typeof vol === 'number') {
      if (vol <= 0) return '-∞ dB';
      return (20 * Math.log10(vol)).toFixed(1) + ' dB';
    }
    return '-- dB';
  }

  // ════════════════════════════════════════════════════════
  // ─── PAGE: VST SETTINGS ──────────────────────────────
  // ════════════════════════════════════════════════════════

  registerPage('vst-settings', {
    render: function (container) {
      container.innerHTML =
        '<div class="vst-settings-header">' +
          '<h2>VST Settings</h2>' +
          '<button class="vst-return" id="vst-return">← Back</button>' +
        '</div>' +
        '<div class="vst-settings-grid">' +
          '<div class="vst-card" id="vst-card-pads">' +
            '<div class="vst-card-name">PADS</div>' +
            '<div class="vst-card-sub">Vital / Surge XT</div>' +
            '<button class="vst-preset-btn" data-track="3">Next Preset</button>' +
          '</div>' +
          '<div class="vst-card" id="vst-card-leads">' +
            '<div class="vst-card-name">LEADS</div>' +
            '<div class="vst-card-sub">Vital / Surge XT</div>' +
            '<button class="vst-preset-btn" data-track="4">Next Preset</button>' +
          '</div>' +
          '<div class="vst-card" id="vst-card-plucks">' +
            '<div class="vst-card-name">PLUCKS</div>' +
            '<div class="vst-card-sub">Vital / Surge XT</div>' +
            '<button class="vst-preset-btn" data-track="5">Next Preset</button>' +
          '</div>' +
          '<div class="vst-card" id="vst-card-bass">' +
            '<div class="vst-card-name">BASS</div>' +
            '<div class="vst-card-sub">Vital / Surge XT</div>' +
            '<button class="vst-preset-btn" data-track="2">Next Preset</button>' +
          '</div>' +
        '</div>';
    },

    onActivate: function () {
      document.getElementById('vst-return').addEventListener('click', function () {
        navigateTo('home');
      });
      var vstPage = document.getElementById('page-vst-settings');
      if (vstPage) {
        vstPage.querySelectorAll('.vst-preset-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var track = parseInt(this.dataset.track);
            sendCommand('fxParam', { trackIdx: track, fxIdx: 1, paramIdx: 0, value: 1 });
            this.style.background = '#2ecc71';
            this.style.color = '#000';
            var self = this;
            setTimeout(function () { self.style.background = ''; self.style.color = ''; }, 300);
          });
        });
      }
    },
  });

  // ════════════════════════════════════════════════════════
  // ─── PAGE: BATTERY MONITOR ───────────────────────────
  // ════════════════════════════════════════════════════════

  registerPage('battery', {
    render: function (container) {
      container.innerHTML =
        '<div class="battery-header">' +
          '<h2>Battery Monitor</h2>' +
          '<button class="battery-return" id="battery-return">← Back</button>' +
        '</div>' +
        '<div class="battery-cards">' +
          '<div class="battery-card" id="battery-main">' +
            '<div class="battery-card-label">Ecoflow Inverter</div>' +
            '<div class="battery-card-pct" id="bat-pct">--%</div>' +
            '<div class="battery-card-watts" id="bat-watts">--W</div>' +
            '<div class="battery-card-eta" id="bat-eta">ETA: --</div>' +
          '</div>' +
          '<div class="battery-card" id="battery-aux">' +
            '<div class="battery-card-label">Aux Battery</div>' +
            '<div class="battery-card-pct" id="bat-aux-pct">--%</div>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:center;color:#555;padding:20px;font-size:12px;">' +
          'Ecoflow API integration pending.<br>Connect Ecoflow to WiFi network.' +
        '</div>';
    },

    onActivate: function () {
      document.getElementById('battery-return').addEventListener('click', function () {
        navigateTo('home');
      });
      fetchBatteryData();
    },
  });

  function fetchBatteryData() {
    // Ecoflow API — uses local HTTP API on the Ecoflow device
    // Endpoint: http://<ecoflow-ip>/api/v1/status
    // Future: uncomment when Ecoflow IP is configured
    /*
    var ecoflowIP = getSetting('ecoflowIP', '192.168.1.200');
    fetch('http://' + ecoflowIP + '/api/v1/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var pct = document.getElementById('bat-pct');
        var watts = document.getElementById('bat-watts');
        var eta = document.getElementById('bat-eta');
        if (pct) pct.textContent = (data.soc || '--') + '%';
        if (watts) watts.textContent = (data.wattsOut || '--') + 'W';
        if (eta) eta.textContent = 'ETA: ' + (data.remainingTime || '--');
      })
      .catch(function() {});
    */
  }

  // ════════════════════════════════════════════════════════
  // ─── PAGE: REQUESTS ──────────────────────────────────
  // ════════════════════════════════════════════════════════

  var REQUESTS_BLOB_URL = 'https://jsonblob.com/api/jsonBlob/019f5394-f14c-7b1b-ba94-c35546262ffa';
  var REQUESTS_LOCAL_API = window.location.protocol + '//' + window.location.hostname + ':3300';
  var requestsPollTimer = null;
  var guestRequests = [];

  function fetchRequests(callback) {
    // Try local server first, fallback to jsonblob
    fetch(REQUESTS_LOCAL_API + '/api/singer/queue?_=' + Date.now())
      .then(function(r) { return r.json(); })
      .then(function(data) {
        guestRequests = (data.queue || []).map(function(e) {
          return {
            name: e.singer || 'Guest',
            song: e.song_title || '?',
            artist: e.song_artist || '',
            done: false,
            time: e.timestamp || Date.now(),
            id: e.id
          };
        });
        if (callback) callback(null, guestRequests);
      })
      .catch(function() {
        // Fallback to jsonblob
        fetch(REQUESTS_BLOB_URL + '?_=' + Date.now())
          .then(function(r) { return r.json(); })
          .then(function(data) {
            guestRequests = data.submissions || [];
            if (callback) callback(null, guestRequests);
          })
          .catch(function(err) {
            if (callback) callback(err);
          });
      });
  }

  function updateRequestBadge() {
    fetchRequests(function(err, subs) {
      if (err) return;
      var pending = subs.filter(function(s) { return !s.done; }).length;
      var badge = document.getElementById('req-badge');
      var sub = document.getElementById('requests-sub');
      if (badge) {
        if (pending > 0) {
          badge.textContent = pending;
          badge.style.display = 'inline';
        } else {
          badge.style.display = 'none';
        }
      }
      if (sub) {
        sub.textContent = pending > 0 ? pending + ' pending' : 'Guest songs';
      }
    });
  }

  registerPage('requests', {
    render: function(container) {
      container.innerHTML =
        '<div class="requests-header">' +
          '<h2>Song Requests</h2>' +
          '<button class="requests-return" id="requests-return">← Back</button>' +
        '</div>' +
        '<div class="requests-actions" style="display:flex;gap:8px;margin-bottom:12px;">' +
          '<button class="refresh-btn" id="requests-refresh" style="background:#252525;color:#f0f0f0;border:1px solid #333;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;">Refresh</button>' +
          '<button class="refresh-btn" id="requests-clear-done" style="background:#252525;color:#f0f0f0;border:1px solid #333;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;">Clear Done</button>' +
        '</div>' +
        '<div id="requests-list">' +
          '<div style="text-align:center;color:#666;padding:40px;font-size:14px;">Loading...</div>' +
        '</div>';
    },

    onActivate: function() {
      document.getElementById('requests-return').addEventListener('click', function() {
        navigateTo('home');
      });
      document.getElementById('requests-refresh').addEventListener('click', function() {
        renderRequestsList();
      });
      document.getElementById('requests-clear-done').addEventListener('click', function() {
        // Clear round on local server
        fetch(REQUESTS_LOCAL_API + '/api/singer/clear-round', { method: 'POST' })
          .then(function() {
            guestRequests = [];
            renderRequestsList();
          })
          .catch(function() {
            guestRequests = guestRequests.filter(function(s) { return !s.done; });
            renderRequestsList();
          });
      });

      loadAndRender();

      // Auto-refresh every 5s while on this page
      if (requestsPollTimer) clearInterval(requestsPollTimer);
      requestsPollTimer = setInterval(function() {
        if (state.currentPage === 'requests') loadAndRender();
      }, 5000);
    },

    onDeactivate: function() {
      if (requestsPollTimer) {
        clearInterval(requestsPollTimer);
        requestsPollTimer = null;
      }
    },
  });

  function loadAndRender() {
    fetchRequests(function(err) {
      if (!err) renderRequestsList();
    });
  }

  function renderRequestsList() {
    var el = document.getElementById('requests-list');
    if (!el) return;

    var pending = guestRequests.filter(function(s) { return !s.done; });
    var done = guestRequests.filter(function(s) { return s.done; });

    if (guestRequests.length === 0) {
      el.innerHTML = '<div style="text-align:center;color:#555;padding:40px;font-size:14px;">No requests yet</div>';
      return;
    }

    var html = '';
    pending.concat(done).forEach(function(s) {
      var timeStr = new Date(s.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      html +=
        '<div class="request-row" style="background:#1a1a1a;border-radius:10px;padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;opacity:' + (s.done ? '0.35' : '1') + ';">' +
          '<div>' +
            '<div style="font-size:18px;font-weight:700;color:#fff;">' + escapeHtml(s.song) + '</div>' +
            '<div style="font-size:14px;color:#ff8800;">' + escapeHtml(s.artist || 'No artist') + '</div>' +
            '<div style="font-size:12px;color:#888;margin-top:4px;">' + escapeHtml(s.name) + ' — ' + timeStr + '</div>' +
          '</div>' +
          '<button class="req-done-btn" data-song="' + escapeHtml(s.song) + '" data-name="' + escapeHtml(s.name) + '" style="background:' + (s.done ? '#444' : '#2ecc71') + ';color:#000;border:none;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;flex-shrink:0;margin-left:10px;">' + (s.done ? '-' : '✓') + '</button>' +
        '</div>';
    });
    el.innerHTML = html;

    el.querySelectorAll('.req-done-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var song = this.dataset.song;
        var name = this.dataset.name;
        guestRequests.forEach(function(s) {
          if (s.song === song && s.name === name && s.time) {
            s.done = !s.done;
          }
        });
        saveRequests(function() {
          renderRequestsList();
        });
      });
    });
  }

  function saveRequests(callback) {
    // Mark done items: delete from local server's singer queue if id exists
    var doneItems = guestRequests.filter(function(s) { return s.done && s.id; });
    var promises = doneItems.map(function(item) {
      return fetch(REQUESTS_LOCAL_API + '/api/singer/queue/' + item.id, { method: 'DELETE' });
    });
    Promise.allSettled(promises).then(function() {
      if (callback) callback();
    }).catch(function() {
      if (callback) callback();
    });

    // Also sync to jsonblob as fallback
    fetch(REQUESTS_BLOB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissions: guestRequests })
    }).then(function() {}).catch(function() {});
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ════════════════════════════════════════════════════════
  // ─── INIT ────────────────────────────────────────────
  // ════════════════════════════════════════════════════════

  function init() {
    createBeatFlash();
    startBeatLoop();
    connectSocketIO();
    navigateTo('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
