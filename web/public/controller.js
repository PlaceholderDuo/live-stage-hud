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
    activeAmpPreset: 'OSD',
    settings: loadSettings(),
    lastStateTime: 0,
    lastPosition: 0,
    beatFlashAnim: null,
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
    if (!state.lastStateTime) return state.position;
    var dt = (performance.now() - state.lastStateTime) / 1000;
    return state.lastPosition + dt;
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

  // ─── WebSocket ────────────────────────────────────────
  let ws = null;
  let reconnectTimer = null;

  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.host || 'rig.local:5800';
    const url = protocol + '//' + host;

    setConnectionStatus('connecting');

    ws = new WebSocket(url);

    ws.onopen = function () {
      setConnectionStatus('connected');
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onclose = function () {
      setConnectionStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = function () {
      setConnectionStatus('disconnected');
    };

    ws.onmessage = function (event) {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.warn('Invalid message from server:', event.data);
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connectWebSocket();
    }, 3000);
  }

  function sendCommand(action, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'command', action: action, ...payload }));
  }

  function handleServerMessage(msg) {
    if (msg.type === 'state') {
      if (msg.bpm) state.tempo = msg.bpm;
      if (msg.position !== undefined) {
        state.lastPosition = msg.position;
        state.lastStateTime = performance.now();
        state.position = msg.position;
      }
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
      if (msg.activeAmpPreset) {
        state.activeAmpPreset = msg.activeAmpPreset;
        var gs = document.getElementById('gtr-amp-sub');
        if (gs) gs.textContent = msg.activeAmpPreset;
      }
      // Dispatch state to active page
      if (pages[state.currentPage] && pages[state.currentPage].onState) {
        pages[state.currentPage].onState(msg);
      }
    }
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
      container.innerHTML = `
        <div class="home-grid">
          <!-- Tap Tempo (spans 2 cols) -->
          <div class="home-btn tap-tempo" id="tap-tempo-btn">
            <span class="bpm-label">BPM</span>
            <span class="bpm-display" id="bpm-display">${state.tempo}</span>
            <div class="pulse-indicator" id="pulse-indicator"></div>
          </div>

          <!-- EDM -->
          <div class="home-btn" id="btn-edm" style="border-color: #2ecc71;">
            <span class="home-btn-label" style="color: #2ecc71;">EDM</span>
            <span class="home-btn-sub">Scene control</span>
          </div>

          <!-- Setlist -->
          <div class="home-btn" id="btn-setlist" style="border-color: #3399ff;">
            <span class="home-btn-label" style="color: #3399ff;">Setlist</span>
            <span class="home-btn-sub">Songs & queue</span>
          </div>

          <!-- MIXER (placeholder) -->
          <div class="home-btn" id="btn-mixer" style="border-color: #333; opacity: 0.4;">
            <span class="home-btn-label" style="color: #666;">Mixer</span>
            <span class="home-btn-sub">Coming soon</span>
          </div>

          <!-- Battery Monitor (placeholder) -->
          <div class="home-btn" id="btn-battery" style="border-color: #333; opacity: 0.4;">
            <span class="home-btn-label" style="color: #666;">Battery</span>
            <span class="home-btn-sub">Coming soon</span>
          </div>

          <!-- MUTE -->
          <div class="home-btn mute-btn live" id="btn-mute">
            <span class="home-btn-label" id="mute-label">LIVE</span>
            <span class="home-btn-sub" id="mute-sub">Tap to mute vocal</span>
          </div>

          <!-- TUNER -->
          <div class="home-btn" id="btn-tuner" style="border-color: #ff8800;">
            <span class="home-btn-label" style="color: #ff8800;">Tuner</span>
            <span class="home-btn-sub">Guitar tune</span>
          </div>

          <!-- GTR FX -->
          <div class="home-btn" id="btn-gtr-fx" style="border-color: #9b59b6;">
            <span class="home-btn-label" style="color: #9b59b6;">GTR FX</span>
            <span class="home-btn-sub">Delay & mod</span>
          </div>

          <!-- GTR AMP -->
          <div class="home-btn" id="btn-gtr-amp" style="border-color: #ff8800;">
            <span class="home-btn-label" style="color: #ff8800;">GTR AMP</span>
            <span class="home-btn-sub" id="gtr-amp-sub">${state.activeAmpPreset}</span>
          </div>

          <!-- KEYS -->
          <div class="home-btn keys-btn on" id="btn-keys">
            <span class="home-btn-label" id="keys-label">KEYS ON</span>
            <span class="home-btn-sub">Tap to mute VST</span>
          </div>

          <!-- REQUESTS -->
          <div class="home-btn" id="btn-requests" style="border-color: #ff8800;">
            <span class="home-btn-label" style="color: #ff8800;">Requests <span class="req-badge" id="req-badge" style="display:none;">0</span></span>
            <span class="home-btn-sub" id="requests-sub">Guest songs</span>
          </div>

          <!-- START -->
          <div class="home-btn start-btn" id="btn-start">
            <span class="home-btn-label">▶ START</span>
            <span class="home-btn-sub">Next song</span>
          </div>

          <!-- MIXER (placeholder) -->
          <div class="home-btn" id="btn-mixer" style="border-color: #333; opacity: 0.4;">
            <span class="home-btn-label" style="color: #666;">Mixer</span>
            <span class="home-btn-sub">Coming soon</span>
          </div>

          <!-- Battery Monitor (placeholder) -->
          <div class="home-btn" id="btn-battery" style="border-color: #333; opacity: 0.4;">
            <span class="home-btn-label" style="color: #666;">Battery</span>
            <span class="home-btn-sub">Coming soon</span>
          </div>
        </div>

        <!-- Small buttons row -->
        <div class="home-small-row">
          <div class="small-btn" id="btn-bumper">
            <span>♪ Bumper</span>
            <span class="double-tap-hint">⟐⟐ DOUBLE TAP</span>
          </div>
          <div class="small-btn" id="btn-lights">
            <span>Lights</span>
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
          // Long press — open VST settings page (bonus, not needed tonight)
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

      // Lights (placeholder)
      document.getElementById('btn-lights').addEventListener('click', function () {
        // TODO
      });
    },

    onState: function (msg) {
      if (msg.bpm) {
        document.getElementById('bpm-display').textContent = Math.round(msg.bpm);
      }
    },
  });

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
      sendCommand('mute', { level: 'vocal' });
    } else if (state.muteState === 'vocal') {
      state.muteState = 'all';
      btn.className = 'home-btn mute-btn mute-all';
      label.textContent = 'MUTED: ALL';
      sub.textContent = 'Tap to restore';
      sendCommand('mute', { level: 'all' });
    } else {
      state.muteState = 'live';
      btn.className = 'home-btn mute-btn live';
      label.textContent = 'LIVE';
      sub.textContent = 'Tap to mute vocal';
      sendCommand('mute', { level: 'none' });
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
        html += '<div class="edm-scene-btn" data-scene="' + (i + 1) + '" style="border-color: ' + s.color + ';">';
        html += '<div class="scene-name" style="color: ' + s.color + ';">' + s.name + '</div>';
        html += '<div class="scene-energy">' + s.energy + '</div>';
        html += '</div>';
      });
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
  });

  // ════════════════════════════════════════════════════════
  // ─── PAGE: TUNER ─────────────────────────────────────
  // ════════════════════════════════════════════════════════

  registerPage('tuner', {
    render: function (container) {
      var teleprompterChecked = getSetting('tunerTeleprompter', false) ? 'checked' : '';
      container.innerHTML =
        '<div class="tuner-note" id="tuner-note">A</div>' +
        '<div class="tuner-cents in-tune" id="tuner-cents">+0¢</div>' +
        '<div class="tuner-string" id="tuner-string">String 5 (A)</div>' +
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
        var note = document.getElementById('tuner-note');
        var cents = document.getElementById('tuner-cents');
        var str = document.getElementById('tuner-string');
        if (note) note.textContent = msg.tuner.note || '--';
        if (cents) {
          var c = msg.tuner.cents || 0;
          cents.textContent = (c > 0 ? '+' : '') + c + '¢';
          cents.className = 'tuner-cents';
          if (Math.abs(c) < 3) cents.classList.add('in-tune');
          else if (c > 0) cents.classList.add('sharp');
          else cents.classList.add('flat');
        }
        if (str && msg.tuner.string) str.textContent = msg.tuner.string;
      }
    },
  });

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
          '<div style="text-align:center;color:#666;padding:40px;font-size:14px;">Waiting for song data...</div>' +
        '</div>';

      document.getElementById('setlist-return').addEventListener('click', function () {
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
      if (msg.queue && document.getElementById('setlist-queue')) {
        renderQueue(msg.queue, msg.songIndex);
      }
    },
  });

  function renderQueue(queue, activeIndex) {
    var el = document.getElementById('setlist-queue');
    if (!el || !queue || !queue.length) {
      el.innerHTML = '<div style="text-align:center;color:#666;padding:40px;font-size:14px;">Empty queue</div>';
      return;
    }
    var html = '';
    queue.forEach(function (song, i) {
      var active = i === activeIndex ? ' active' : '';
      html += '<div class="queue-item' + active + '">';
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
  // ─── PAGE: GTR AMP PRESETS ──────────────────────────
  // ════════════════════════════════════════════════════════

  var gtrAmpPresets = [
    { name: 'OSD',      cln: false, color: '#ff8800' },
    { name: 'SSS',      cln: false, color: '#ff8800' },
    { name: 'SSS CLN',  cln: true,  color: '#3399ff' },
    { name: 'BE',       cln: false, color: '#ff8800' },
    { name: 'BE CLN',   cln: true,  color: '#3399ff' },
    { name: 'TRLX',     cln: false, color: '#ff8800' },
    { name: 'TWD',      cln: false, color: '#ff8800' },
  ];

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
        var badge = p.cln ? 'CLEAN' : 'DRIVE';
        html +=
          '<div class="gtr-amp-preset' + active + '" data-preset="' + p.name + '" style="border-color: ' + p.color + ';">' +
            '<div class="preset-name" style="color: ' + p.color + ';">' + p.name + '</div>' +
            '<div class="preset-badge" style="color: ' + p.color + ';">' + badge + '</div>' +
          '</div>';
      });

      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.gtr-amp-preset').forEach(function (el) {
        el.addEventListener('click', function () {
          var preset = this.dataset.preset;
          state.activeAmpPreset = preset;
          sendCommand('gtr_amp_preset', { preset: preset });
          container.querySelectorAll('.gtr-amp-preset').forEach(function (b) {
            b.classList.remove('active');
          });
          this.classList.add('active');
          // Update subtitle on home page
          var homeSub = document.getElementById('gtr-amp-sub');
          if (homeSub) homeSub.textContent = preset;
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
  // ─── PAGE: REQUESTS ──────────────────────────────────
  // ════════════════════════════════════════════════════════

  var REQUESTS_BLOB_URL = 'https://jsonblob.com/api/jsonBlob/019f5394-f14c-7b1b-ba94-c35546262ffa';
  var REQUESTS_LOCAL_API = 'http://localhost:3300';
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
    connectWebSocket();
    navigateTo('home');

    // Poll for guest song requests every 10s
    updateRequestBadge();
    setInterval(updateRequestBadge, 10000);

    // Handle visibility change — reconnect if needed
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !state.connected) {
        connectWebSocket();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
