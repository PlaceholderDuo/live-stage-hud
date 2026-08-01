// Live Stage HUD — Professional Conductor Stage Monitor (Version 2 Refined)
// ==========================================================================
// Pure flat high-contrast black/white design. Exactly matches the mockup.
// Left-aligned metadata, white-box bar & beat conductor.
// Center-aligned 3-Line rolling engine with bright yellow chords in brackets.
// Proportional block-based progress timeline. Next song key auto-lookup.

(function () {

  "use strict";

  // ── DOM refs ──
  var $ = function (id) { return document.getElementById(id); };

  var topTitle = $("topTitle");
  var topKey = $("topKey");
  var topBpm = $("topBpm");
  var topNextVal = $("topNextVal");

  var barCounter = $("barCounter");
  var metronomeDot = $("metronomeDot");
  var statusText = $("statusText");

  var sectionLabel = $("sectionLabel");
  var ringProgress = document.querySelector(".ring-progress");
  var ringTicks = $("ringTicks");
  var ringTimeEl = document.querySelector(".ring-time");
  var ringTotalEl = document.querySelector(".ring-total");
  var songTransition = $("songTransition");
  var stTitle = $("stTitle");
  var stMeta = $("stMeta");

  // 6-line rolling engine DOM elements
  var linePast3 = $("linePast3");
  var linePast2 = $("linePast2");
  var linePast1 = $("linePast1");
  var linePresent = $("linePresent");
  var lineFuture1 = $("lineFuture1");
  var lineFuture2 = $("lineFuture2");
  var lineEls = [linePast3, linePast2, linePast1, linePresent, lineFuture1, lineFuture2];

  var lyricEngine = $("lyricEngine");
  var soloEngine = $("soloEngine");
  var soloGrid = $("soloGrid");
  var soloProgressFill = $("soloProgressFill");

  var timelineNotches = $("timelineNotches");

  var footerElapsed = $("footerElapsed");
  var footerTotal = $("footerTotal");
  var nextSong = $("nextSong");
  var footerSection = $("footerSection");

  var edgeFlashTop = $("edgeFlashTop");
  var edgeFlashBottom = $("edgeFlashBottom");
  var heartbeatBanner = $("heartbeatBanner");
  var meterRow = $("meterRow");
  var hudNotes = $("hudNotes");
  var notesTimeout = null;

  // ── State ──
  var currentSongId = null;
  var parsedLines = [];
  var parsedDirectives = {};
  var currentNextSongTitle = null;
  var nextSongKey = null;

  var lastBeat = 0;
  var flashTimeout = null;
  var loadingEl = null;
  var syncWarningEl = null;

  // Feature 4 & 5: First-song safety, song transition
  var isFirstSong = true;
  var firstSongTimeout = null;
  var songTransitionTimeout = null;
  var lastSongId = null;

  // ═══════════════════════════════════════════════════════════
  // FIT HUD — Scale everything to fit the browser window
  // ═══════════════════════════════════════════════════════════

  function fitHud() {
    var winH = window.innerHeight;
    var winW = window.innerWidth;
    var scaleH = Math.min(1, Math.max(0.45, winH / 1080));
    var scaleW = Math.min(1, winW / 900);
    var scale = Math.min(scaleH, scaleW);
    document.documentElement.style.setProperty('--hud-scale', scale);
  }

  window.addEventListener('resize', fitHud);

  // ═══════════════════════════════════════════════════════════
  // CHORDPRO PARSER → chord-word pairs
  // ═══════════════════════════════════════════════════════════

  function cleanLabel(text) {
    if (!text) return "";
    return text.replace(/^[^a-zA-Z0-9]+/, "").trim() || "Verse";
  }

  function stripEmoji(text) {
    if (!text) return "";
    return text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}]/gu, "");
  }

  // Maps clean types and sequence counters to beautiful minimal tokens like [V1], [C1]
  // Note: server now precomputes tokens in sections[].token
  // This client-side function is a fallback for older data.
  function getShortToken(type, index) {
    var t = (type || "").toLowerCase();
    if (t === "intro") return "[I]";
    if (t === "verse") return "[V" + index + "]";
    if (t === "chorus") return "[C" + index + "]";
    if (t === "solo") return "[S]";
    if (t === "bridge") return "[B]";
    if (t === "outro" || t === "ending") return "[O]";
    if (t === "interlude") return "[INT]";
    return "[" + t.substring(0, 3).toUpperCase() + "]";
  }

  // Match a bare chord name (no brackets): root note + optional quality + optional bass
  var chordNameRe = /^[A-G][b#]?(?:m|dim|aug|sus[24]|add\d+|maj7|maj9|m6|m7|m9|7|9|11|13|6)*(?:\/[A-G][b#]?)?$/;

  // "I got my [D]first real six-[A]string"
  // → [{chord:"", word:"I got my "}, {chord:"D", word:"first real six-"}, {chord:"A", word:"string"}]
  function parseLinePairs(raw) {
    var pairs = [];
    var re = /\[([^\]]+)\]/g;
    var chords = [];
    var match;

    while ((match = re.exec(raw)) !== null) {
      chords.push({
        name: match[1],
        index: match.index,
        end: match.index + match[0].length,
      });
    }

    if (chords.length === 0) {
      var plain = stripEmoji(raw);
      if (plain) {
        // Check if this is a bare chord line: all tokens are chord names
        var tokens = plain.trim().split(/\s+/);
        var allChordTokens = true;
        for (var ti = 0; ti < tokens.length; ti++) {
          if (!chordNameRe.test(tokens[ti])) { allChordTokens = false; break; }
        }
        if (allChordTokens && tokens.length > 0) {
          for (var ti = 0; ti < tokens.length; ti++) {
            pairs.push({ chord: tokens[ti], word: "" });
          }
          return pairs;
        }
        pairs.push({ chord: "", word: plain });
      }
      return pairs;
    }

    // Text before first chord
    if (chords[0].index > 0) {
      var pre = stripEmoji(raw.substring(0, chords[0].index));
      if (pre) pairs.push({ chord: "", word: pre });
    }

    // Each chord gets the text up to the next chord (or end of line)
    for (var i = 0; i < chords.length; i++) {
      var start = chords[i].end;
      var end = (i + 1 < chords.length) ? chords[i + 1].index : raw.length;
      var word = stripEmoji(raw.substring(start, end));
      pairs.push({ chord: chords[i].name, word: word });
    }

    return pairs;
  }

  function parseChordPro(text) {
    var lines = [];
    var directives = {};
    var rawLines = text.split("\n");

    var currentType = "verse";
    var currentLabel = "";
    var currentDuration = null;
    var isNewFormat = false;

    for (var i = 0; i < rawLines.length; i++) {
      var raw = rawLines[i].trim();
      if (!raw) continue;

      // ── New format section header: ## Name @time ──
      if (raw.substring(0, 2) === "##") {
        isNewFormat = true;
        var rest = raw.substring(2).trim();
        var label = rest;
        var atIdx = rest.lastIndexOf("@");
        if (atIdx >= 0) {
          label = rest.substring(0, atIdx).trim();
        }
        currentDuration = null;
        var lc = label.toLowerCase();
        if (lc.indexOf("chorus") >= 0) currentType = "chorus";
        else if (lc.indexOf("verse") >= 0) currentType = "verse";
        else if (lc.indexOf("solo") >= 0) currentType = "solo";
        else if (lc.indexOf("bridge") >= 0) currentType = "bridge";
        else if (lc.indexOf("intro") >= 0) currentType = "intro";
        else if (lc.indexOf("outro") >= 0 || lc.indexOf("ending") >= 0) currentType = "outro";
        else if (lc.indexOf("interlude") >= 0) currentType = "interlude";
        else currentType = label ? currentType : "verse";
        currentLabel = label || currentLabel;
        continue;
      }

      // ── Metadata directive: {title: ...} or old-style {start_of_*} ──
      if (raw.charAt(0) === "{" && raw.indexOf("}") >= 0) {
        var dm = raw.match(/^\{([^:]+):\s*(.+)\}$/);
        var dname = "", dval = "";
        if (dm) { dname = dm[1].trim().toLowerCase(); dval = dm[2].trim(); }
        else { dname = raw.substring(1, raw.length - 1).trim().toLowerCase(); }

        // Old format: {start_of_chorus: Chorus 1}
        if (dname.indexOf("start_of_") >= 0) {
          isNewFormat = false;
          var tp = dname.replace("start_of_", "").replace(/\s+/g, "_");
          if (tp.indexOf("chorus") >= 0) currentType = "chorus";
          else if (tp.indexOf("verse") >= 0) currentType = "verse";
          else if (tp.indexOf("solo") >= 0) currentType = "solo";
          else if (tp.indexOf("bridge") >= 0) currentType = "bridge";
          else if (tp.indexOf("intro") >= 0) currentType = "intro";
          else currentType = "verse";
          currentLabel = (dval || "").replace(/@\w+\s*=\s*\S+/g, "").trim();
          currentDuration = null;
          var durMatch = dval.match(/@duration\s*=\s*(\d+)/i);
          if (durMatch) currentDuration = parseInt(durMatch[1], 10);
          continue;
        }

        if (dname.indexOf("end_of_") >= 0) {
          currentType = "verse";
          currentLabel = "";
          currentDuration = null;
          continue;
        }

        directives[dname] = dval;
        continue;
      }

      // ── Content line ──
      var timeAnnot = null;
      var content = raw;

      if (isNewFormat) {
        var atIdx = content.lastIndexOf("@");
        if (atIdx >= 0) {
          var tn = parseFloat(content.substring(atIdx + 1).trim());
          if (!isNaN(tn)) { timeAnnot = tn; content = content.substring(0, atIdx).trim(); }
        }
        // Fallback: old @time=N prefix still present on some lines in migrated files
        if (timeAnnot === null) {
          var tmFallback = content.match(/@time\s*=\s*([\d]+\.?\d*)\s*/i);
          if (tmFallback) timeAnnot = parseFloat(tmFallback[1]);
        }
        content = content.replace(/@time\s*=\s*[\d]+\.?\d*\s*/gi, "")
                         .replace(/@bar\s*=\s*\d+\s*/gi, "")
                         .replace(/##\s+[^@]*?(?:\s*@[\d.]+)?$/, "")  // strip embedded ## headers
                         .trim();
        // Unwrap bare chord markers: /C G Am/
        if (content.charAt(0) === "/" && content.lastIndexOf("/") > 0) {
          content = content.substring(1, content.lastIndexOf("/")).trim();
        }
      } else {
        content = raw.replace(/@time\s*=\s*[\d]+\.?\d*\s*/gi, "")
                     .replace(/@bar\s*=\s*\d+\s*/gi, "")
                     .replace(/\s+/g, " ").trim();
        var tm = raw.match(/@time\s*=\s*([\d]+\.?\d*)\s*/i);
        if (tm) timeAnnot = parseFloat(tm[1]);
      }

      lines.push({
        pairs: parseLinePairs(content),
        type: currentType,
        label: currentLabel,
        _time: timeAnnot,
        _bar: null,
        _duration: currentDuration,
      });
    }

    // Post-process: distribute chord-only line chords across following lyric lines
    var mergedLines = [];
    var pendingChords = [];
    var globalChordIdx = 0;
    for (var i = 0; i < lines.length; i++) {
      if (isChordOnlyLine(lines[i])) {
        for (var ci = 0; ci < lines[i].pairs.length; ci++) {
          if (lines[i].pairs[ci].chord) pendingChords.push(lines[i].pairs[ci].chord);
        }
        continue;
      }
      if (pendingChords.length > 0) {
        var merged = [];
        for (var pi = 0; pi < lines[i].pairs.length; pi++) {
          if (lines[i].pairs[pi].word && !lines[i].pairs[pi].chord) {
            var chord = pendingChords[globalChordIdx % pendingChords.length];
            merged.push({ chord: chord, word: lines[i].pairs[pi].word });
            globalChordIdx++;
          } else {
            merged.push(lines[i].pairs[pi]);
          }
        }
        lines[i].pairs = merged;
      }
      mergedLines.push(lines[i]);
    }
    lines = mergedLines;

    return { lines: lines, directives: directives };
  }

  // ═══════════════════════════════════════════════════════════
  // LINE → TIME ESTIMATOR (operates in seconds, no BPM needed for @time=N)
  // ═══════════════════════════════════════════════════════════
  // Priority:
  //   1. @time=N on line → use directly (LRCLIB ground truth)
  //   2. @bar=N on line → convert to time using BPM from state
  //   3. No annotation → distribute proportionally within section time spans
  //
  // Returns an array of time values (seconds) for each line.

  function estimateLineTimes(lines, sections, bpm) {
    if (!sections || sections.length === 0 || lines.length === 0) {
      return lines.map(function (_, i) { return i; }); // fallback: 1 second per line
    }

    bpm = bpm || 120;
    var beatsPerBar = 4;
    var times = new Array(lines.length);

    // Collect anchor lines that have @time=N annotations
    var timeAnchors = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i]._time !== null && lines[i]._time !== undefined) {
        timeAnchors.push({ idx: i, time: lines[i]._time });
      }
    }

    // If no @time anchors, try @bar anchors (convert to time using BPM)
    if (timeAnchors.length === 0) {
      for (var i = 0; i < lines.length; i++) {
        if (lines[i]._bar !== null && lines[i]._bar !== undefined) {
          var t = ((lines[i]._bar - 1) * beatsPerBar * 60) / bpm;
          timeAnchors.push({ idx: i, time: t });
        }
      }
    }

    // Sort anchors by time (defense against out-of-order annotations)
    timeAnchors.sort(function (a, b) { return a.time - b.time; });

    // Compute section time ranges from bar positions
    var sectionRanges = [];
    var totalTime = 0;
    for (var i = 0; i < sections.length; i++) {
      var startTime = ((sections[i].bar - 1) * beatsPerBar * 60) / bpm;
      // If section has a 'time' field from server, use it directly
      if (sections[i].time !== null && sections[i].time !== undefined) {
        startTime = sections[i].time;
      }
      var endTime;
      if (i + 1 < sections.length) {
        var endBar = sections[i + 1].bar;
        if (sections[i + 1].time !== null && sections[i + 1].time !== undefined) {
          endTime = sections[i + 1].time;
        } else {
          endTime = ((endBar - 1) * beatsPerBar * 60) / bpm;
        }
      } else {
        endTime = startTime + ((sections[i].bar ? 16 : 4) * beatsPerBar * 60) / bpm;
      }
      var span = endTime - startTime;
      if (span <= 0) span = 8; // minimum 8 seconds per section
      sectionRanges.push({ startTime: startTime, endTime: endTime, span: span });
      totalTime += span;
    }
    if (totalTime <= 0) totalTime = lines.length * 2; // fallback: 2 seconds per line

    if (timeAnchors.length > 0) {
      // ── Anchor-based distribution ──
      // Anchors are trust points. Distribute unannotated lines between them.

      for (var a = 0; a < timeAnchors.length; a++) {
        times[timeAnchors[a].idx] = timeAnchors[a].time;
      }

      var unannotated = [];
      for (var i = 0; i < lines.length; i++) {
        if (times[i] === undefined) unannotated.push(i);
      }
      if (unannotated.length === 0) return times;

      var anchorIdx = 0;
      var gapLines = [];

      function flushTimeGap(beforeTime, afterTime) {
        if (gapLines.length === 0) return;
        var span = afterTime - beforeTime;
        if (span <= 0) span = gapLines.length * 2;
        for (var gi = 0; gi < gapLines.length; gi++) {
          var t = beforeTime + ((gi + 1) / (gapLines.length + 1)) * span;
          times[gapLines[gi]] = Math.max(0.1, Math.round(t * 100) / 100);
        }
        gapLines = [];
      }

      for (var i = 0; i < unannotated.length; i++) {
        var lineIdx = unannotated[i];
        while (anchorIdx < timeAnchors.length && timeAnchors[anchorIdx].idx < lineIdx) {
          var prevTime = anchorIdx > 0 ? timeAnchors[anchorIdx - 1].time : 0;
          flushTimeGap(prevTime, timeAnchors[anchorIdx].time);
          anchorIdx++;
        }
        gapLines.push(lineIdx);
      }

      var lastAnchorTime = timeAnchors.length > 0 ? timeAnchors[timeAnchors.length - 1].time : 0;
      var afterLast = Math.max(lastAnchorTime + 8, totalTime);
      flushTimeGap(lastAnchorTime, afterLast);

      for (var i = 0; i < times.length; i++) {
        if (times[i] === undefined) times[i] = Math.round((i * 2) * 100) / 100;
      }
      return times;
    }

    // ── No anchors at all: proportional by section time span ──
    var linesPerSection = [];
    var assigned = 0;
    for (var i = 0; i < sectionRanges.length; i++) {
      var count = Math.round((sectionRanges[i].span / totalTime) * lines.length);
      linesPerSection.push(count);
      assigned += count;
    }

    var diff = lines.length - assigned;
    var sorted = sectionRanges.map(function (sr, idx) { return { idx: idx, span: sr.span }; });
    sorted.sort(function (a, b) { return b.span - a.span; });
    for (var d = 0; d < Math.abs(diff); d++) {
      var target = sorted[d % sorted.length].idx;
      if (diff > 0) linesPerSection[target]++;
      else if (linesPerSection[target] > 0) linesPerSection[target]--;
    }

    var linePtr = 0;
    for (var secIdx = 0; secIdx < sectionRanges.length; secIdx++) {
      var sec = sectionRanges[secIdx];
      var count = Math.max(1, linesPerSection[secIdx]);
      for (var li = 0; li < count && linePtr < lines.length; li++) {
        var t = sec.startTime + (li / count) * sec.span;
        times[linePtr] = Math.max(0.1, Math.round(t * 100) / 100);
        linePtr++;
      }
    }

    while (linePtr < lines.length) {
      times[linePtr] = Math.round((totalTime + linePtr * 2) * 100) / 100;
      linePtr++;
    }

    return times;
  }

  // ═══════════════════════════════════════════════════════════
  // FEATURE 2: 12-Color Chord Coloring (Circle of Fifths)
  // ═══════════════════════════════════════════════════════════

  function getChordRootColor(chord) {
    if (!chord) return null;
    var root = chord.match(/^[A-G][b#]?/);
    if (!root) return null;
    root = root[0];
    var map = {
      'C': '#ff3333', 'C#': '#ff6b35', 'Db': '#ff6b35',
      'D': '#ff8800', 'D#': '#ffaa00', 'Eb': '#ffaa00',
      'E': '#ffdd00',
      'F': '#33cc66', 'F#': '#1abc9c', 'Gb': '#1abc9c',
      'G': '#3399ff', 'G#': '#5b6abf', 'Ab': '#5b6abf',
      'A': '#9933ff', 'A#': '#cc33ff', 'Bb': '#cc33ff',
      'B': '#ff3399'
    };
    return map[root] || null;
  }

  // ═══════════════════════════════════════════════════════════
  // CHORD-WORD PAIR HTML BUILDER
  // ═══════════════════════════════════════════════════════════

  function buildLinePairsHTML(line) {
    var container = document.createElement("div");
    container.className = "tp-line-content";

    for (var i = 0; i < line.pairs.length; i++) {
      var pair = line.pairs[i];
      var pairEl = document.createElement("span");
      pairEl.className = "chord-word-pair";

      var chordEl = document.createElement("span");
      chordEl.className = pair.chord ? "chord" : "chord empty";
      chordEl.textContent = pair.chord ? "[" + pair.chord + "]" : "\u00A0";
      if (pair.chord) {
        var c = getChordRootColor(pair.chord);
        if (c) chordEl.style.color = c;
      }
      pairEl.appendChild(chordEl);

      var wordEl = document.createElement("span");
      wordEl.className = "word";
      wordEl.textContent = pair.word || "\u00A0";
      pairEl.appendChild(wordEl);

      container.appendChild(pairEl);
    }

    return container;
  }

  // Check if a line is pure chords (instrumental or bare chord names like "G", "Am", "D7")
  function isChordOnlyLine(line) {
    if (!line) return true;
    // Check if ALL pairs have either empty words or bare chord names
    for (var i = 0; i < line.pairs.length; i++) {
      var cleanWord = (line.pairs[i].word || "").trim();
      var chord = (line.pairs[i].chord || "").trim();
      // A pair with a chord name in the word field and no chord field is a bare chord
      if (cleanWord.length > 0) {
        if (!chord && chordNameRe.test(cleanWord)) {
          // Convert bare chord word to chord field, empty word
          line.pairs[i].chord = cleanWord;
          line.pairs[i].word = "";
          continue; // this pair is now chord-only
        }
        return false; // has real word content
      }
    }
    return true;
  }

  // Check if a line is harmony
  function isHarmonyLine(line) {
    if (!line) return false;
    for (var i = 0; i < line.pairs.length; i++) {
      var word = (line.pairs[i].word || "").toLowerCase();
      var chord = (line.pairs[i].chord || "").toLowerCase();
      if (word.indexOf("harmony") >= 0 || chord.indexOf("harmony") >= 0) return true;
      if (word.indexOf("backing") >= 0 || word.indexOf("bg") >= 0) return true;
      if (word.indexOf("(") >= 0 && word.indexOf(")") >= 0) return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // PREPARE SONG LINES — compute _time for every line
  // ═══════════════════════════════════════════════════════════
  // Priority:
  //   1. @time=N on line → use directly (ground truth, BPM-independent)
  //   2. @bar=N on line → convert to time using state BPM
  //   3. Neither → estimateTimeLines distributes proportionally
  //
  // After this, every line has a `_time` field used by renderRollingEngine.

  function prepareSongLines(lines, sections, bpm) {
    if (!lines || lines.length === 0) return;

    // Compute time estimates for lines without @time anchor
    var timeEstimates = estimateLineTimes(lines, sections, bpm);

    for (var i = 0; i < lines.length; i++) {
      // Preserve existing @time=N values
      if (lines[i]._time === null || lines[i]._time === undefined) {
        lines[i]._time = timeEstimates[i];
      }
      // Store bar for backward compat (section label healing uses it)
      if (lines[i]._bar === null || lines[i]._bar === undefined) {
        // Derive bar from time for conductor display
        lines[i]._bar = Math.floor(lines[i]._time * bpm / (4 * 60)) + 1;
      }
    }

    // Heuristically map server sections to ChordPro-parsed types/labels
    // Only if server didn't send proper tokens (legacy healing)
    if (!sections) return;
    var needsHealing = false;
    for (var j = 0; j < sections.length; j++) {
      if (!sections[j].token) { needsHealing = true; break; }
    }
    if (!needsHealing) return;

    for (var j = 0; j < sections.length; j++) {
      var sec = sections[j];
      var bestLine = null;
      var minDiff = Infinity;
      var secTime = sec.time || ((sec.bar - 1) * 4 * 60) / (bpm || 120);
      for (var k = 0; k < lines.length; k++) {
        var diff = Math.abs((lines[k]._time || 0) - secTime);
        if (diff < minDiff) {
          minDiff = diff;
          bestLine = lines[k];
        }
      }
      if (bestLine && bestLine.label) {
        sec.text = bestLine.label;
        sec.type = bestLine.type;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3-LINE ROLLING ENGINE
  // ═══════════════════════════════════════════════════════════

  function renderRollingEngine(position, lines, sections, bpm) {
    if (!lines || lines.length === 0) return;

    // Find current line by time position using _time annotations
    // Each line now has _time (seconds) — either from @time=N or estimated
    var currentIdx = 0;
    for (var i = 0; i < lines.length; i++) {
      var lineTime = lines[i]._time;
      if (lineTime !== null && lineTime !== undefined && lineTime <= position) {
        currentIdx = i;
      }
    }

    // Check for solo section: if the current line or any line in this
    // section has _duration set (from @duration) and the section is solo
    var inSolo = false;
    var soloRemaining = 0;
    for (var i = currentIdx; i < lines.length && (i === currentIdx || lines[i].type === lines[currentIdx].type); i++) {
      if (lines[i].type === "solo" || (lines[i]._duration && lines[i].type === "solo")) {
        inSolo = true;
        var soloStartTime = lines[i]._time || 0;
        soloRemaining = (lines[i]._duration || 16) * (4 * 60) / (bpm || 120) - (position - soloStartTime);
        break;
      }
    }
    // Also check if current line is chord-only (legacy solo detection)
    if (!inSolo && lines[currentIdx] && isChordOnlyLine(lines[currentIdx])) {
      inSolo = true;
      soloRemaining = 8;
    }

    if (inSolo) {
      lyricEngine.style.display = "none";
      soloEngine.style.display = "flex";
      // Show chords from all lines in the solo section
      soloGrid.innerHTML = "";
      for (var i = currentIdx; i < lines.length; i++) {
        if (lines[i].type !== "solo" && lines[i].type !== lines[currentIdx].type) break;
        for (var ci = 0; ci < lines[i].pairs.length; ci++) {
          if (lines[i].pairs[ci].chord) {
            var span = document.createElement("span");
            span.className = "chord";
            span.textContent = "[" + lines[i].pairs[ci].chord + "]";
            soloGrid.appendChild(span);
          }
        }
      }
      var pct = Math.min(100, Math.max(0, 100 - (soloRemaining / Math.max(lines[currentIdx]._duration || 16, 1)) * 100));
      soloProgressFill.style.width = pct + "%";
      return;
    } else {
      lyricEngine.style.display = "block";
      soloEngine.style.display = "none";
    }

    // Build array of 6 lines: [past3, past2, past1, present, future1, future2]
    var indices = [
      currentIdx - 3,
      currentIdx - 2,
      currentIdx - 1,
      currentIdx,
      currentIdx + 1,
      currentIdx + 2
    ];
    var classNames = ["past-3", "past-2", "past-1", "present", "future-1", "future-2"];

    for (var li = 0; li < lineEls.length; li++) {
      var el = lineEls[li];
      var idx = indices[li];
      el.innerHTML = "";
      el.className = "tp-line " + classNames[li];
      if (idx >= 0 && idx < lines.length) {
        el.appendChild(buildLinePairsHTML(lines[idx]));
        if (idx === currentIdx && isHarmonyLine(lines[idx])) {
          el.classList.add("harmony");
        }
      } else {
        el.innerHTML = "\u2026";
      }
    }
  }

  function renderSoloGrid(line) {
    soloGrid.innerHTML = "";
    for (var i = 0; i < line.pairs.length; i++) {
      if (line.pairs[i].chord) {
        var span = document.createElement("span");
        span.className = "chord";
        span.textContent = "[" + line.pairs[i].chord + "]";
        soloGrid.appendChild(span);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FEATURE 1: CIRCULAR COUNTDOWN RING
  // ═══════════════════════════════════════════════════════════

  function updateCountdownRing(position, duration, sections) {
    var rp = ringProgress;
    var rt = ringTimeEl;
    var rtl = ringTotalEl;
    if (!rp) return;

    var circumference = 534;
    var fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
    var remaining = Math.max(0, duration - position);

    rp.setAttribute("stroke-dashoffset", circumference * (1 - fraction));

    if (rt) rt.textContent = formatTime(remaining);
    if (rtl) {
      var totalRemaining = duration ? (remaining - 0) : 0;
      rtl.textContent = remaining > 0 ? "-" + formatTime(totalRemaining) : "0:00";
    }

    rp.classList.remove("ring-green", "ring-yellow", "ring-red", "ring-paused", "ring-dim", "pulse", "grow-shrink");

    if (duration <= 0 || fraction === 0) {
      rp.classList.add("ring-dim");
    } else {
      var pctRemaining = duration > 0 ? remaining / duration : 0;
      if (pctRemaining > 0.25) {
        rp.classList.add("ring-green");
      } else if (pctRemaining > 0.10) {
        rp.classList.add("ring-yellow");
      } else {
        rp.classList.add("ring-red");
        rp.classList.add(pctRemaining < 0.05 ? "grow-shrink" : "pulse");
      }
    }

    if (sections && sections.length > 0 && duration > 0) {
      renderRingTickMarks(sections, duration);
    }
  }

  function renderRingTickMarks(sections, duration) {
    var ticks = ringTicks;
    if (!ticks || !sections || !duration) return;
    ticks.innerHTML = "";

    var cx = 100, cy = 100, r = 88;
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      var secTime = sec.time !== null && sec.time !== undefined
        ? sec.time
        : ((sec.bar - 1) * 4 * 60) / 120;
      if (secTime <= 0 && i > 0) continue;
      
      var angle = ((secTime / duration) * 360) - 90;
      var rad = angle * Math.PI / 180;
      
      var x1 = cx + (r - 6) * Math.cos(rad);
      var y1 = cy + (r - 6) * Math.sin(rad);
      var x2 = cx + (r + 4) * Math.cos(rad);
      var y2 = cy + (r + 4) * Math.sin(rad);
      
      var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", "#fff");
      line.setAttribute("stroke-width", "2");
      ticks.appendChild(line);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FEATURE 3: INLINE SECTION LABEL — appears above current lyrics
  // ═══════════════════════════════════════════════════════════

  var SECTION_COLORS = {
    "intro": "#9b59b6", "verse": "#3498db", "chorus": "#2ecc71",
    "pre-chorus": "#1abc9c", "bridge": "#f1c40f", "solo": "#e67e22",
    "outro": "#7f8c8d", "interlude": "#e91e90"
  };

  var _lastLabelIdx = -1;

  function updateSectionLabel(sections, position, bpm) {
    if (!sectionLabel || !sections || sections.length === 0) return;

    var idx = -1;
    for (var i = sections.length - 1; i >= 0; i--) {
      var secTime = sections[i].time !== null && sections[i].time !== undefined
        ? sections[i].time
        : ((sections[i].bar - 1) * 4 * 60) / (bpm || 120);
      if (position >= secTime) { idx = i; break; }
    }

    if (idx >= 0 && idx !== _lastLabelIdx) {
      _lastLabelIdx = idx;
      var sec = sections[idx];
      var label = sec.text || sec.token || "";
      label = cleanLabel(label).toUpperCase();
      var color = SECTION_COLORS[sec.type] || "#4fc3f7";

      sectionLabel.textContent = label;
      sectionLabel.style.color = color;
      sectionLabel.classList.add("visible");
    }
  }

  function fadeSectionLabel() {
    if (sectionLabel) sectionLabel.classList.remove("visible");
  }

  // ═══════════════════════════════════════════════════════════
  // FEATURE 4+5: SONG TRANSITION + FIRST-SONG SAFETY
  // ═══════════════════════════════════════════════════════════

  function showSongTransition(title, key, bpm) {
    var overlay = songTransition;
    if (!overlay) return;
    if (stTitle) stTitle.textContent = title || "\u2014";
    if (stMeta) stMeta.textContent = (key || "\u2014") + "  \u2669=" + (bpm || "\u2014");
    overlay.style.display = "flex";
    overlay.offsetHeight;
    overlay.classList.add("visible");
  }

  function hideSongTransition() {
    var overlay = songTransition;
    if (!overlay) return;
    overlay.classList.remove("visible");
    setTimeout(function () {
      overlay.style.display = "none";
    }, 500);
  }

  function clearLyricsDisplay() {
    for (var i = 0; i < lineEls.length; i++) {
      lineEls[i].innerHTML = "";
    }
    loadingEl.style.display = "block";
    loadingEl.textContent = "";
    parsedLines = [];
    parsedDirectives = {};
    lyricEngine._prepared = false;
  }

  // ═══════════════════════════════════════════════════════════
  // PROGRESS ANCHOR — Proportional Timeline
  // ═══════════════════════════════════════════════════════════

  function renderTimelineNotches(sections, currentBar, totalBars) {
    timelineNotches.innerHTML = "";
    if (!sections || sections.length === 0 || !totalBars) return;

    var verseCount = 0;
    var chorusCount = 0;

    for (var j = 0; j < sections.length; j++) {
      var sec = sections[j];
      var startBar = sec.bar;
      var endBar = (j + 1 < sections.length) ? sections[j + 1].bar : totalBars;
      var length = endBar - startBar;
      var pct = (length / totalBars) * 100;

      // Use server-precomputed token when available, fall back to client counting
      var token = sec.token;
      if (!token) {
        var type = (sec.type || "").toLowerCase();
        if (type === "verse") { verseCount++; token = getShortToken("verse", verseCount); }
        else if (type === "chorus") { chorusCount++; token = getShortToken("chorus", chorusCount); }
        else { token = getShortToken(type, 0); }
      }

      var block = document.createElement("div");
      block.className = "timeline-block";
      block.style.width = pct + "%";
      block.textContent = token;

      if (currentBar >= endBar) {
        block.classList.add("past");
      } else {
        block.classList.add("future");
      }

      timelineNotches.appendChild(block);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CONDUCER METRONOME (High Contrast Bar & Beat)
  // ═══════════════════════════════════════════════════════════

  function updateConductor(position, bpm) {
    if (!bpm || bpm <= 0) return;

    var totalBeats = (position * bpm) / 60;
    var bar = Math.floor(totalBeats / 4) + 1;
    var beat = Math.floor(totalBeats % 4) + 1;

    barCounter.textContent = "BAR: " + bar;

    // High contrast active beat numbering inside the card
    for (var i = 1; i <= 4; i++) {
      var el = $("beat" + i);
      if (el) {
        if (i === beat) {
          el.style.color = "#000000";
          el.style.fontWeight = "900";
          el.style.opacity = "1.0";
        } else {
          el.style.color = "#cccccc";
          el.style.fontWeight = "400";
          el.style.opacity = "0.25";
        }
      }
    }

    // Metronome flasher (bottom right corner)
    var metronome = $("metronomeDot");
    if (metronome) {
      if (beat === 1) {
        metronomeDot.className = "pulse";
      } else {
        metronomeDot.className = "";
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NEXT SONG KEY AUTO LOOKUP
  // ═══════════════════════════════════════════════════════════

  function fetchNextSongKey(nextSongTitle) {
    if (!nextSongTitle || nextSongTitle === currentNextSongTitle) return;
    currentNextSongTitle = nextSongTitle;

    var slug = nextSongTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/song-data/" + encodeURIComponent(slug), true);
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data && data.key) {
            nextSongKey = data.key;
          } else {
            nextSongKey = null;
          }
        } catch (e) {
          nextSongKey = null;
        }
      } else {
        nextSongKey = null;
      }
      updateNextSongDisplay(nextSongTitle);
    };
    xhr.onerror = function () {
      nextSongKey = null;
      updateNextSongDisplay(nextSongTitle);
    };
    xhr.send();
  }

  function updateNextSongDisplay(title) {
    var displayStr = title || "\u2014";
    if (nextSongKey) {
      displayStr += " \"" + nextSongKey + "\"";
    }
    nextSong.innerHTML = "<span>" + displayStr + "</span>";
    topNextVal.textContent = displayStr;
  }

  // ═══════════════════════════════════════════════════════════
  // DATA FETCHING
  // ═══════════════════════════════════════════════════════════

  function fetchAndRenderChords(songId) {
    if (!songId || songId === currentSongId) return;
    currentSongId = songId;
    loadingEl.style.display = "block";
    loadingEl.textContent = "Loading charts\u2026";

    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/chordpro/" + encodeURIComponent(songId), true);
    xhr.onload = function () {
      if (xhr.status === 200) {
        var res = parseChordPro(xhr.responseText);
        parsedLines = res.lines;
        parsedDirectives = res.directives;
        loadingEl.style.display = "none";
        lyricEngine._prepared = false;
      } else {
        parsedLines = [];
        parsedDirectives = {};
        loadingEl.style.display = "block";
        loadingEl.textContent = "No chord charts";
      }
    };
    xhr.onerror = function () {
      parsedLines = [];
      parsedDirectives = {};
      loadingEl.style.display = "block";
      loadingEl.textContent = "Connection lost";
    };
    xhr.send();
  }

  // ═══════════════════════════════════════════════════════════
  // EDGE FLASH
  // ═══════════════════════════════════════════════════════════

  function triggerEdgeFlash() {
    if (flashTimeout) clearTimeout(flashTimeout);
    edgeFlashTop.classList.add("edge-flash-active");
    edgeFlashBottom.classList.add("edge-flash-active");
    flashTimeout = setTimeout(function () {
      edgeFlashTop.classList.remove("edge-flash-active");
      edgeFlashBottom.classList.remove("edge-flash-active");
    }, 200);
  }

  var lastSectionIdx = -1;

  function detectSectionChange(sections, currentBar) {
    if (!sections || sections.length === 0) return;
    var idx = -1;
    for (var i = sections.length - 1; i >= 0; i--) {
      if (currentBar >= sections[i].bar) { idx = i; break; }
    }
    if (idx !== lastSectionIdx) {
      lastSectionIdx = idx;
      if (idx >= 0) {
        triggerEdgeFlash();
        footerSection.textContent = cleanLabel(sections[idx].text) || "";
      }
    }
    if (idx >= 0 && idx + 1 < sections.length) {
      var nextBar = sections[idx + 1].bar;
      if (currentBar >= nextBar - 2 && currentBar < nextBar) {
        if (!document.querySelector(".edge-flash-active")) {
          triggerEdgeFlash();
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PERFORMANCE NOTES
  // ═══════════════════════════════════════════════════════════

  function showNotes(text) {
    if (notesTimeout) clearTimeout(notesTimeout);
    hudNotes.textContent = text || "";
    hudNotes.classList.add("visible");
    var duration = isFirstSong ? 15000 : 8000;
    notesTimeout = setTimeout(function () {
      hudNotes.classList.remove("visible");
    }, duration);
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  function formatTime(seconds) {
    if (!seconds || seconds < 0) return "0:00";
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function updateMeters(levels) {
    meterRow.innerHTML = "";
    if (!levels || levels.length === 0) return;
    for (var i = 0; i < Math.min(levels.length, 8); i++) {
      var strip = document.createElement("div");
      strip.className = "meter-strip";
      var fill = document.createElement("div");
      fill.className = "meter-fill";
      var pct = Math.min((levels[i].level || 0) * 100, 100);
      fill.style.width = pct + "%";
      if (pct > 85) fill.classList.add("clip");
      else if (pct > 70) fill.classList.add("warn");
      strip.appendChild(fill);
      meterRow.appendChild(strip);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SOCKET INIT
  // ═══════════════════════════════════════════════════════════

  statusText.innerHTML = "&#9679; Connecting\u2026";
  statusText.className = "status-dot disconnected";

  // Loading message element (sibling to line elements, not a replacement)
  loadingEl = document.createElement("div");
  loadingEl.className = "waiting";
  loadingEl.textContent = "Waiting for show\u2026";
  lyricEngine.appendChild(loadingEl);

  // Scale HUD to fit the window
  fitHud();

  syncWarningEl = $("syncWarning");

  // ── Heartbeat: detect stale state updates ──
  var lastStateTime = 0;
  var heartbeatInterval = setInterval(function () {
    if (Date.now() - lastStateTime > 3500) {
      heartbeatBanner.style.display = "block";
    } else {
      heartbeatBanner.style.display = "none";
    }
  }, 1000);

  setTimeout(function () {
    var socket = io({
      transports: ["polling", "websocket"],
      timeout: 10000,
    });

    socket.on("connect", function () {
      statusText.innerHTML = "&#9679; Connected";
      statusText.className = "status-dot connected";
      isFirstSong = true;
      lastSongId = null;
    });

    socket.on("disconnect", function () {
      statusText.innerHTML = "&#9679; Disconnected";
      statusText.className = "status-dot disconnected";
    });

    socket.on("connect_error", function () {
      statusText.innerHTML = "&#9679; Connection Error";
      statusText.className = "status-dot disconnected";
    });

    socket.on("state", function (s) {
      try {
      lastStateTime = Date.now();

      // Stacked Pro Metadata
      topTitle.textContent = s.currentSong || "\u2014";
      topKey.textContent = s.currentKey || "\u2014";
      topBpm.textContent = s.bpm || "\u2014";

      // ── Song change transition (Feature 5) ──
      if (s.songId && s.songId !== lastSongId) {
        if (lastSongId !== null) {
          clearLyricsDisplay();
          showSongTransition(s.currentSong, s.currentKey, s.bpm);
          if (songTransitionTimeout) clearTimeout(songTransitionTimeout);
          songTransitionTimeout = setTimeout(function () {
            hideSongTransition();
            fetchAndRenderChords(lastSongId);
          }, 2000);
        } else {
          fetchAndRenderChords(s.songId);
        }
        lastSongId = s.songId;
        if (s.notes) showNotes(s.notes);
        lastSectionIdx = -1;
        _lastLabelIdx = -1;
        fadeSectionLabel();

        // First-song mode: start 15s countdown (Feature 4)
        if (isFirstSong) {
          if (firstSongTimeout) clearTimeout(firstSongTimeout);
          firstSongTimeout = setTimeout(function () {
            isFirstSong = false;
          }, 15000);
        }
      }

      // Sync health warning
      if (syncWarningEl && s.lyricSync && !s.lyricSync.ok && s.lyricSync.warnings) {
        syncWarningEl.style.display = "block";
        syncWarningEl.textContent = "SYNC: " + s.lyricSync.warnings.join(" | ");
      } else if (syncWarningEl) {
        syncWarningEl.style.display = "none";
      }

      // Conductor Counter & Metronome
      updateConductor(s.position || 0, s.bpm || 0);

      // Countdown ring (Feature 1)
      updateCountdownRing(s.position || 0, s.duration || 0, s.sections);

      // Time display
      footerElapsed.textContent = formatTime(s.position);
      footerTotal.textContent = formatTime(s.duration);

      // Auto next song key lookup
      if (s.nextSong) {
        fetchNextSongKey(s.nextSong);
      } else {
        updateNextSongDisplay("\u2014");
      }

      var barCalc = Math.floor((s.position || 0) * (s.bpm || 0) / (4 * 60)) + 1;

      // Section label (Feature 3) + Timeline
      if (s.sections && s.sections.length > 0) {
        updateSectionLabel(s.sections, s.position || 0, s.bpm || 120);

        var totalBars = Math.floor((s.duration || 0) * (s.bpm || 0) / (4 * 60)) + 1;
        renderTimelineNotches(s.sections, barCalc, totalBars || 128);
      }

      detectSectionChange(s.sections, barCalc);

      // Debug overlay
      var _d = document.getElementById("hudDebug");
      if (_d) {
        var _word0 = parsedLines.length > 0 && parsedLines[0].pairs.length > 0 ? (parsedLines[0].pairs[0].word||"-").substring(0,30) : "-";
        var _t0 = parsedLines.length > 0 && parsedLines[0]._time !== undefined ? parsedLines[0]._time.toFixed(1) : "-";
        _d.textContent = "song=" + (s.songId||"-") + " lines=" + parsedLines.length + " sec=" + (s.sections?s.sections.length:0) + " t=" + (s.position||0).toFixed(1) + " t0=" + _t0 + " prep=" + lyricEngine._prepared + " w0='" + _word0 + "'";
      }

      // 6-Line Engine Renderer — uses _time (seconds) for line selection
      if (parsedLines.length > 0 && s.sections && s.sections.length > 0) {
        if (!lyricEngine._prepared) {
          lyricEngine._prepared = true;
          prepareSongLines(parsedLines, s.sections, s.bpm || 120);
        }
        renderRollingEngine(s.position || 0, parsedLines, s.sections, s.bpm || 120);
      }
      } catch (e) {
        console.error("HUD ERROR:", e.message, e.stack);
        document.getElementById("hudDebug") && (document.getElementById("hudDebug").textContent = "ERROR: " + e.message);
      }
    });

    socket.on("trackLevels", function (levels) {
      updateMeters(levels);
    });

  }, 0);
})();
